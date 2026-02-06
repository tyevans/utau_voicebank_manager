/**
 * Lit web components for the UTAU Voicebank Manager.
 *
 * All components use the 'uvm-' prefix for namespacing.
 * Components are custom elements that can be used in HTML templates.
 */

// Root application component
export { UvmApp } from './uvm-app.js';

// Waveform editor for audio visualization and oto.ini parameter editing
export { UvmWaveformEditor } from './uvm-waveform-editor.js';

// Pure waveform canvas rendering component (no markers or interaction)
export { UvmWaveformCanvas } from './uvm-waveform-canvas.js';

// Sample browser for selecting voicebank samples
export { UvmSampleBrowser } from './uvm-sample-browser.js';

// Voicebank panel for voicebank selection and management
export { UvmVoicebankPanel } from './uvm-voicebank-panel.js';

// Virtual scrolling sample grid view
export { UvmSampleGrid } from './uvm-sample-grid.js';

// Compact sample list view
export { UvmSampleListView } from './uvm-sample-list-view.js';

// Batch ML auto-detection operations dialog
export { UvmBatchOperations } from './uvm-batch-operations.js';

// Sample card for mini-waveform grid display
export { UvmSampleCard } from './uvm-sample-card.js';

// Main editor view integrating all components
export { UvmEditorView } from './uvm-editor-view.js';

// Audio loading and AudioContext lifecycle management (headless)
export { UvmAudioManager } from './uvm-audio-manager.js';
export type { AudioLoadedDetail } from './uvm-audio-manager.js';

// OtoEntry CRUD, undo/redo, and auto-detection management (headless)
export { UvmOtoManager } from './uvm-oto-manager.js';
export type { OtoEntriesLoadedDetail, OtoEntryChangedDetail, OtoEntrySavedDetail, OtoDetectedDetail } from './uvm-oto-manager.js';
export { DEFAULT_OTO_VALUES } from './uvm-oto-manager.js';

// Editor toolbar with keyboard shortcuts and status indicator
export { UvmEditorToolbar } from './uvm-editor-toolbar.js';

// Entry list panel for managing multiple oto entries per sample
export { UvmEntryList } from './uvm-entry-list.js';

// Upload zone for drag-drop file uploads
export { UvmUploadZone } from './uvm-upload-zone.js';

// Toast notification manager for user feedback
export { UvmToastManager } from './uvm-toast-manager.js';

// Recording prompter for guided recording sessions
export { UvmRecordingPrompter } from './uvm-recording-prompter.js';
export type { PhonemePrompt } from './uvm-recording-prompter.js';

// Recording engine sub-component (MediaRecorder management)
export { UvmRecordEngine } from './uvm-record-engine.js';
export type { RecordingState, RecordingDataDetail } from './uvm-record-engine.js';

// Live waveform visualization sub-component
export { UvmLiveWaveform } from './uvm-live-waveform.js';

// Speech recognizer sub-component (Web Speech API)
export { UvmSpeechRecognizer } from './uvm-speech-recognizer.js';
export type { WordsUpdatedDetail } from './uvm-speech-recognizer.js';

// Recording session for guided voicebank creation flow
export { UvmRecordingSession } from './uvm-recording-session.js';

// Welcome view for first-time users
export { UvmWelcomeView } from './uvm-welcome-view.js';

// Phrase preview for demo song playback
export { UvmPhrasePreview } from './uvm-phrase-preview.js';

// First Sing button for instant voicebank validation
export { UvmFirstSing } from './uvm-first-sing.js';

// Quick Phrase Mode for text-to-singing playback
export { UvmQuickPhrase } from './uvm-quick-phrase.js';

// Value bar for displaying oto.ini marker values
export { UvmValueBar } from './uvm-value-bar.js';

// Context bar for voicebank/sample breadcrumb and actions
export { UvmContextBar } from './uvm-context-bar.js';

// Precision drawer for numeric marker value editing
export { UvmPrecisionDrawer } from './uvm-precision-drawer.js';
export type { PrecisionDrawerChangeDetail } from './uvm-precision-drawer.js';

// Spectrogram visualization for FFT frequency analysis
export { UvmSpectrogram } from './uvm-spectrogram.js';

// Marker handle for oto.ini parameter visualization
export { UvmMarkerHandle } from './uvm-marker-handle.js';
export type { MarkerDragDetail } from './uvm-marker-handle.js';

// Marker layer for oto.ini marker rendering, drag interaction, and region shading
export { UvmMarkerLayer } from './uvm-marker-layer.js';
export type { GhostMarker } from './uvm-marker-layer.js';

// Playback controller for audio transport, marker preview, and melody preview
export { UvmPlaybackController } from './uvm-playback-controller.js';

// Keyboard shortcut overlay
export { UvmShortcutOverlay } from './uvm-shortcut-overlay.js';

// Batch review modal for reviewing auto-detected samples
export { UvmBatchReview } from './uvm-batch-review.js';
export type { BatchSampleResult, BatchReviewCompleteDetail } from './uvm-batch-review.js';

// Validation view for reviewing and exporting oto.ini
export { UvmValidationView } from './uvm-validation-view.js';

// Metadata editor for character.txt and readme.txt
export { UvmMetadataEditor } from './uvm-metadata-editor.js';

// Alignment settings for configuring auto-detection parameters
export { UvmAlignmentSettings } from './uvm-alignment-settings.js';
export type { AlignmentMethod, AlignmentChangeDetail } from './uvm-alignment-settings.js';

// Voice completion flow for post-recording experience
export { UvmVoiceComplete } from './uvm-voice-complete.js';

// Ambient training status for voice training jobs
export { UvmTrainingStatus } from './uvm-training-status.js';

// Voice playground for "type to hear yourself" experience
export { UvmVoicePlayground } from './uvm-voice-playground.js';
