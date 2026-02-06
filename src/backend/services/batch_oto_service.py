"""Service for batch processing voicebank samples through ML pipeline."""

import logging
from collections.abc import Callable
from pathlib import Path

from src.backend.domain.batch_oto import BatchOtoResult
from src.backend.domain.oto_entry import OtoEntry
from src.backend.ml.oto_suggester import OtoSuggester
from src.backend.repositories.interfaces import OtoRepositoryInterface
from src.backend.services.voicebank_service import (
    VoicebankNotFoundError,
    VoicebankService,
)

logger = logging.getLogger(__name__)

# Confidence threshold below which a suggestion is flagged for manual review
LOW_CONFIDENCE_THRESHOLD = 0.3


class BatchOtoService:
    """Service for batch-processing voicebank samples.

    Coordinates between the voicebank service for sample listing,
    the oto suggester for ML-based parameter generation, and the
    oto repository for persisting results.
    """

    def __init__(
        self,
        voicebank_service: VoicebankService,
        oto_suggester: OtoSuggester,
        oto_repository: OtoRepositoryInterface,
    ) -> None:
        """Initialize the batch oto service.

        Args:
            voicebank_service: Service for voicebank operations
            oto_suggester: ML-based oto parameter suggester
            oto_repository: OtoRepositoryInterface for oto entry persistence
        """
        self._voicebank_service = voicebank_service
        self._oto_suggester = oto_suggester
        self._oto_repository = oto_repository

    async def generate_oto_for_voicebank(
        self,
        voicebank_id: str,
        overwrite_existing: bool = False,
        progress_callback: Callable[[int, int, str], None] | None = None,
        sofa_language: str = "ja",
        confidence_threshold: float = LOW_CONFIDENCE_THRESHOLD,
    ) -> BatchOtoResult:
        """Generate oto entries for all samples in a voicebank.

        Uses batch processing when SOFA is available, which is much faster
        than processing files one-by-one because the ML model is loaded only once.

        Args:
            voicebank_id: The voicebank to process
            overwrite_existing: If True, replace existing entries.
                               If False, skip files with entries.
            progress_callback: Optional callback(current, total, filename)
                              for progress updates. Note: with batch processing,
                              progress is reported at start and completion only.
            sofa_language: Language code for SOFA alignment (ja, en, zh, ko, fr).
                          Defaults to "ja" for Japanese.
            confidence_threshold: Minimum confidence score for an entry to be
                                 automatically saved to oto.ini. Entries below
                                 this threshold are returned as pending_review_entries
                                 for manual acceptance. Defaults to 0.3.

        Returns:
            BatchOtoResult with generated entries and statistics

        Raises:
            VoicebankNotFoundError: If voicebank does not exist
        """
        # Verify voicebank exists (raises VoicebankNotFoundError if not)
        await self._voicebank_service.get(voicebank_id)

        # Get list of all WAV samples
        samples = await self._voicebank_service.list_samples(voicebank_id)
        total_samples = len(samples)

        # Get existing oto entries
        existing_entries = await self._oto_repository.get_entries(voicebank_id) or []
        existing_filenames = {entry.filename for entry in existing_entries}

        # Collect sample paths that need processing (not skipped)
        samples_to_process: list[tuple[str, Path]] = []
        skipped = 0

        for filename in samples:
            # Skip if has existing entry and not overwriting
            if filename in existing_filenames and not overwrite_existing:
                logger.debug(f"Skipping {filename}: already has oto entry")
                skipped += 1
                continue

            # Get the sample path
            try:
                sample_path = await self._voicebank_service.get_sample_path(
                    voicebank_id, filename
                )
                samples_to_process.append((filename, sample_path))
            except VoicebankNotFoundError:
                logger.warning(f"Sample file not found: {filename}")
                # Will be tracked as failed later

        # Report progress: starting batch processing
        if progress_callback:
            to_process_count = len(samples_to_process)
            progress_callback(
                0,
                total_samples,
                f"Starting batch processing of {to_process_count} samples...",
            )

        # Process all samples in batch, separating by confidence
        accepted_entries: list[OtoEntry] = []
        pending_review_entries: list[OtoEntry] = []
        failed_files: list[str] = []
        low_confidence_files: list[str] = []
        confidence_sum = 0.0
        processed = 0

        if samples_to_process:
            # Extract just the paths for batch processing
            paths = [path for _, path in samples_to_process]

            # Call batch_suggest_oto once for all files
            suggestions = await self._oto_suggester.batch_suggest_oto(
                paths, sofa_language=sofa_language
            )

            # Process results
            for (filename, _), suggestion in zip(
                samples_to_process, suggestions, strict=True
            ):
                if suggestion is None:
                    failed_files.append(filename)
                    continue

                # Convert OtoSuggestion to OtoEntry
                entry = OtoEntry(
                    filename=suggestion.filename,
                    alias=suggestion.alias,
                    offset=suggestion.offset,
                    consonant=suggestion.consonant,
                    cutoff=suggestion.cutoff,
                    preutterance=suggestion.preutterance,
                    overlap=suggestion.overlap,
                )

                confidence_sum += suggestion.confidence
                processed += 1

                # Gate by confidence: only save entries above the threshold
                if suggestion.confidence < confidence_threshold:
                    pending_review_entries.append(entry)
                    low_confidence_files.append(filename)
                    logger.debug(
                        f"Low confidence for {filename}: "
                        f"confidence={suggestion.confidence:.2f} "
                        f"(threshold={confidence_threshold}), pending review"
                    )
                else:
                    accepted_entries.append(entry)
                    logger.debug(
                        f"Generated oto for {filename}: "
                        f"alias={entry.alias}, confidence={suggestion.confidence:.2f}"
                    )

        # Track files that couldn't be found as failed
        found_filenames = {filename for filename, _ in samples_to_process}
        for filename in samples:
            should_process = filename not in existing_filenames or overwrite_existing
            if should_process and filename not in found_filenames:
                failed_files.append(filename)

        failed = len(failed_files)

        # Report progress: batch complete
        pending_count = len(pending_review_entries)
        if progress_callback:
            progress_callback(
                total_samples,
                total_samples,
                f"Batch complete: {processed} processed, {skipped} skipped, "
                f"{failed} failed, {pending_count} pending review",
            )

        # Calculate average confidence
        average_confidence = confidence_sum / processed if processed > 0 else 0.0

        # Save only accepted entries (above confidence threshold) to oto.ini
        if accepted_entries:
            await self._save_entries(
                voicebank_id,
                accepted_entries,
                existing_entries,
                overwrite_existing,
            )
            logger.info(
                f"Saved {len(accepted_entries)} oto entries for voicebank '{voicebank_id}'"
            )

        if pending_review_entries:
            logger.info(
                f"{pending_count} entries below confidence threshold "
                f"({confidence_threshold}) returned for manual review"
            )

        return BatchOtoResult(
            voicebank_id=voicebank_id,
            total_samples=total_samples,
            processed=processed,
            skipped=skipped,
            failed=failed,
            entries=accepted_entries,
            pending_review_entries=pending_review_entries,
            failed_files=failed_files,
            low_confidence_files=low_confidence_files,
            average_confidence=round(average_confidence, 3),
            confidence_threshold=confidence_threshold,
        )

    async def _save_entries(
        self,
        voicebank_id: str,
        new_entries: list[OtoEntry],
        existing_entries: list[OtoEntry],
        overwrite_existing: bool,
    ) -> None:
        """Save generated entries, merging with existing as needed.

        Args:
            voicebank_id: Voicebank identifier
            new_entries: Newly generated entries
            existing_entries: Existing entries from oto.ini
            overwrite_existing: Whether to replace existing entries
        """
        if overwrite_existing:
            # Build a set of new entry keys by (filename, alias) tuple.
            # VCV files have multiple aliases per filename (e.g., _akasa.wav
            # has both "a ka" and "a sa"), so filename alone is not unique.
            new_entry_keys = {(entry.filename, entry.alias) for entry in new_entries}

            # Keep existing entries whose (filename, alias) is not being replaced
            merged_entries = [
                e
                for e in existing_entries
                if (e.filename, e.alias) not in new_entry_keys
            ]
            # Add all new entries
            merged_entries.extend(new_entries)
        else:
            # Just append new entries (files without existing entries)
            merged_entries = list(existing_entries) + new_entries

        # Sort entries by filename for consistent output
        merged_entries.sort(key=lambda e: e.filename)

        await self._oto_repository.save_entries(voicebank_id, merged_entries)
