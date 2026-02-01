/**
 * Router configuration for UTAU Voicebank Manager
 * Uses @vaadin/router for client-side routing with lazy loading
 */

import { Router, type Route, type Commands, type Context } from '@vaadin/router';

// Singleton router instance
let router: Router | null = null;

/**
 * Route configuration with lazy loading via dynamic imports
 */
const routes: Route[] = [
  {
    path: '/',
    action: async (_context: Context, commands: Commands) => {
      await import('./components/uvm-welcome-view.js');
      return commands.component('uvm-welcome-view');
    },
  },
  {
    path: '/editor',
    action: async (_context: Context, commands: Commands) => {
      await import('./components/uvm-editor-view.js');
      return commands.component('uvm-editor-view');
    },
  },
  {
    path: '/editor/:voicebankId',
    action: async (_context: Context, commands: Commands) => {
      await import('./components/uvm-editor-view.js');
      return commands.component('uvm-editor-view');
    },
  },
  {
    path: '/editor/:voicebankId/sample/:sampleId',
    action: async (_context: Context, commands: Commands) => {
      await import('./components/uvm-editor-view.js');
      return commands.component('uvm-editor-view');
    },
  },
  {
    path: '/recording',
    action: async (_context: Context, commands: Commands) => {
      await import('./components/uvm-recording-session.js');
      return commands.component('uvm-recording-session');
    },
  },
  {
    path: '(.*)',
    action: (_context: Context, commands: Commands) => {
      return commands.redirect('/');
    },
  },
];

/**
 * Initialize the router with the given outlet element
 * @param outlet - The HTML element where routed components will be rendered
 * @returns The initialized Router instance
 */
export function initRouter(outlet: HTMLElement): Router {
  router = new Router(outlet);
  router.setRoutes(routes);
  return router;
}

/**
 * Get the current router instance
 * @returns The Router instance or null if not initialized
 */
export function getRouter(): Router | null {
  return router;
}

/**
 * Navigate to a given path
 * @param path - The path to navigate to
 */
export function navigateTo(path: string): void {
  Router.go(path);
}

/**
 * Navigate to the editor view
 * @param voicebankId - Optional voicebank ID to edit
 * @param sampleId - Optional sample ID within the voicebank
 */
export function navigateToEditor(voicebankId?: string, sampleId?: string): void {
  if (voicebankId && sampleId) {
    const encodedVoicebankId = encodeURIComponent(voicebankId);
    const encodedSampleId = encodeURIComponent(sampleId);
    Router.go(`/editor/${encodedVoicebankId}/sample/${encodedSampleId}`);
  } else if (voicebankId) {
    const encodedVoicebankId = encodeURIComponent(voicebankId);
    Router.go(`/editor/${encodedVoicebankId}`);
  } else {
    Router.go('/editor');
  }
}

/**
 * Navigate to the recording session view
 */
export function navigateToRecording(): void {
  Router.go('/recording');
}

/**
 * Navigate to the welcome/home view
 */
export function navigateToWelcome(): void {
  Router.go('/');
}
