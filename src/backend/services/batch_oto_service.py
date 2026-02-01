"""Service for batch processing voicebank samples through ML pipeline."""

import logging
from collections.abc import Callable
from pathlib import Path

from src.backend.domain.batch_oto import BatchOtoResult
from src.backend.domain.oto_entry import OtoEntry
from src.backend.ml.oto_suggester import OtoSuggester
from src.backend.repositories.oto_repository import OtoRepository
from src.backend.services.voicebank_service import (
    VoicebankNotFoundError,
    VoicebankService,
)

logger = logging.getLogger(__name__)

# Confidence threshold below which a suggestion is considered low-confidence
# (likely used default values due to detection failure)
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
        oto_repository: OtoRepository,
    ) -> None:
        """Initialize the batch oto service.

        Args:
            voicebank_service: Service for voicebank operations
            oto_suggester: ML-based oto parameter suggester
            oto_repository: Repository for oto entry persistence
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

        # Process all samples in batch
        generated_entries: list[OtoEntry] = []
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

                generated_entries.append(entry)
                confidence_sum += suggestion.confidence
                processed += 1

                # Track low-confidence suggestions (likely used defaults)
                if suggestion.confidence < LOW_CONFIDENCE_THRESHOLD:
                    low_confidence_files.append(filename)
                    logger.debug(
                        f"Low confidence for {filename}: "
                        f"confidence={suggestion.confidence:.2f}"
                    )
                else:
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

        # Log summary of low-confidence files
        if low_confidence_files:
            logger.info(
                f"{len(low_confidence_files)} files had low confidence "
                "(may need manual review): {low_confidence_files[:5]}..."
                if len(low_confidence_files) > 5
                else f"{len(low_confidence_files)} files had low confidence "
                f"(may need manual review): {low_confidence_files}"
            )

        # Report progress: batch complete
        if progress_callback:
            progress_callback(
                total_samples,
                total_samples,
                f"Batch complete: {processed} processed, {skipped} skipped, {failed} failed",
            )

        # Calculate average confidence
        average_confidence = confidence_sum / processed if processed > 0 else 0.0

        # Save all generated entries to oto.ini
        if generated_entries:
            await self._save_entries(
                voicebank_id,
                generated_entries,
                existing_entries,
                overwrite_existing,
            )
            logger.info(
                f"Saved {len(generated_entries)} oto entries for voicebank '{voicebank_id}'"
            )

        return BatchOtoResult(
            voicebank_id=voicebank_id,
            total_samples=total_samples,
            processed=processed,
            skipped=skipped,
            failed=failed,
            entries=generated_entries,
            failed_files=failed_files,
            average_confidence=round(average_confidence, 3),
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
            # Build a map of new entries by filename
            new_entry_map = {entry.filename: entry for entry in new_entries}

            # Keep existing entries for files not in the new set
            merged_entries = [
                e for e in existing_entries if e.filename not in new_entry_map
            ]
            # Add all new entries
            merged_entries.extend(new_entries)
        else:
            # Just append new entries (files without existing entries)
            merged_entries = list(existing_entries) + new_entries

        # Sort entries by filename for consistent output
        merged_entries.sort(key=lambda e: e.filename)

        await self._oto_repository.save_entries(voicebank_id, merged_entries)
