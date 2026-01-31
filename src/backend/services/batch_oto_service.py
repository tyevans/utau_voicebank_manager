"""Service for batch processing voicebank samples through ML pipeline."""

import logging
from collections.abc import Callable

from src.backend.domain.batch_oto import BatchOtoResult
from src.backend.domain.oto_entry import OtoEntry
from src.backend.ml.oto_suggester import OtoSuggester
from src.backend.repositories.oto_repository import OtoRepository
from src.backend.services.voicebank_service import (
    VoicebankNotFoundError,
    VoicebankService,
)

logger = logging.getLogger(__name__)


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
    ) -> BatchOtoResult:
        """Generate oto entries for all samples in a voicebank.

        Processes each WAV sample through the ML pipeline to generate
        suggested oto parameters. Optionally skips files that already
        have oto entries.

        Args:
            voicebank_id: The voicebank to process
            overwrite_existing: If True, replace existing entries.
                               If False, skip files with entries.
            progress_callback: Optional callback(current, total, filename)
                              for progress updates

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

        # Track statistics
        processed = 0
        skipped = 0
        failed = 0
        generated_entries: list[OtoEntry] = []
        failed_files: list[str] = []
        confidence_sum = 0.0

        for index, filename in enumerate(samples):
            # Report progress
            if progress_callback:
                progress_callback(index + 1, total_samples, filename)

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
            except VoicebankNotFoundError:
                logger.warning(f"Sample file not found: {filename}")
                failed += 1
                failed_files.append(filename)
                continue

            # Generate oto suggestion
            try:
                suggestion = await self._oto_suggester.suggest_oto(sample_path)

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

                logger.debug(
                    f"Generated oto for {filename}: "
                    f"alias={entry.alias}, confidence={suggestion.confidence:.2f}"
                )

            except Exception as e:
                logger.warning(f"Failed to process {filename}: {e}")
                failed += 1
                failed_files.append(filename)
                continue

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
