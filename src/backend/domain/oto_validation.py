"""Shared validation logic for oto.ini parameter relationships.

Both OtoEntry (strict) and OtoSuggestion (clamping) use these rules.
The core invariants are:
  - consonant >= offset (fixed region end cannot precede playback start)
  - preutterance >= offset (note alignment point cannot precede playback start)
"""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class OtoParams:
    """Minimal parameter set for cross-field validation."""

    offset: float
    consonant: float
    cutoff: float
    preutterance: float
    overlap: float


def validate_oto_strict(params: OtoParams) -> None:
    """Raise ValueError for physically impossible parameter combinations.

    Used by OtoEntry to reject invalid configurations at parse time.
    """
    if params.consonant < params.offset:
        raise ValueError(
            f"consonant ({params.consonant}) must be >= offset ({params.offset}): "
            f"the fixed region end cannot be before the playback start"
        )
    if params.preutterance < params.offset:
        raise ValueError(
            f"preutterance ({params.preutterance}) must be >= offset ({params.offset}): "
            f"the note alignment point cannot be before the playback start"
        )


def clamp_oto_params(params: OtoParams) -> tuple[OtoParams, list[str]]:
    """Clamp parameters to valid ranges, returning corrected params and warnings.

    Used by OtoSuggestion to salvage ML-generated values that violate
    cross-field constraints. Each correction is recorded as a warning string.

    Returns:
        A tuple of (clamped_params, warnings). Warnings list is empty when
        no clamping was needed.
    """
    warnings: list[str] = []
    offset = params.offset
    consonant = params.consonant
    cutoff = params.cutoff
    preutterance = params.preutterance
    overlap = params.overlap

    # Constraint: consonant >= offset
    if consonant < offset:
        warnings.append(
            f"clamped consonant from {consonant} to {offset}: "
            f"fixed region end cannot precede playback start"
        )
        consonant = offset

    # Constraint: preutterance >= offset
    if preutterance < offset:
        warnings.append(
            f"clamped preutterance from {preutterance} to {offset}: "
            f"note alignment point cannot precede playback start"
        )
        preutterance = offset

    # Constraint: overlap should not exceed preutterance (soft clamp)
    if overlap > preutterance:
        warnings.append(
            f"clamped overlap from {overlap} to {preutterance}: "
            f"overlap longer than preutterance causes synthesis artifacts"
        )
        overlap = preutterance

    clamped = OtoParams(
        offset=offset,
        consonant=consonant,
        cutoff=cutoff,
        preutterance=preutterance,
        overlap=overlap,
    )
    return clamped, warnings


def check_oto_warnings(params: OtoParams) -> list[str]:
    """Return warnings for unusual-but-valid parameter relationships.

    These are soft checks the API or UI can surface to the user
    without rejecting the entry. An empty list means no warnings.
    Used by OtoEntry.check_relationships().
    """
    warnings: list[str] = []

    if params.cutoff >= 0:
        warnings.append(
            f"cutoff is non-negative ({params.cutoff}): typically negative "
            f"to mark playback end relative to audio end"
        )

    if params.overlap > params.preutterance:
        warnings.append(
            f"overlap ({params.overlap}) exceeds preutterance ({params.preutterance}): "
            f"overlap longer than preutterance may cause synthesis artifacts"
        )

    return warnings
