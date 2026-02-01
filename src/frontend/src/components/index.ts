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

// Main editor view integrating all components
export { UvmEditorView } from './uvm-editor-view.js';

// Entry list panel for managing multiple oto entries per sample
export { UvmEntryList } from './uvm-entry-list.js';

// Upload zone for drag-drop file uploads
export { UvmUploadZone } from './uvm-upload-zone.js';

// Toast notification manager for user feedback
export { UvmToastManager } from './uvm-toast-manager.js';

// Recording prompter for guided recording sessions
export { UvmRecordingPrompter } from './uvm-recording-prompter.js';
export type { PhonemePrompt } from './uvm-recording-prompter.js';

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
