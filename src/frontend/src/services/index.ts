/**
 * API client services for the UTAU Voicebank Manager.
 *
 * This module exports API clients for communicating with the backend.
 * Services handle HTTP requests, error handling, and response parsing.
 */

// API client
export { api, ApiClient, ApiError } from './api.js';

// Type definitions
export type {
  MlStatus,
  OtoEntry,
  OtoEntryCreate,
  OtoEntryUpdate,
  OtoSuggestion,
  PhonemeSegment,
  Voicebank,
  VoicebankSummary,
} from './types.js';
