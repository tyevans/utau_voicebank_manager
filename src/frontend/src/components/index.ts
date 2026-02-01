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
