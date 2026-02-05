"""Generic pagination response model."""

from typing import Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    """Paginated response wrapper for list endpoints.

    Wraps a list of items with pagination metadata including the total
    count of items (before slicing), the limit, and the offset applied.
    """

    items: list[T] = Field(description="Page of results")
    total: int = Field(ge=0, description="Total number of items available")
    limit: int = Field(ge=1, description="Maximum items per page")
    offset: int = Field(ge=0, description="Number of items skipped")
