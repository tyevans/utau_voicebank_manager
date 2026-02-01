import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';

// Import Shoelace alert component for toast styling
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

/**
 * Toast notification data structure.
 */
interface Toast {
  id: number;
  message: string;
  variant: 'primary' | 'success' | 'warning' | 'danger' | 'neutral';
  duration: number;
}

/**
 * Global toast notification manager component.
 *
 * Provides a singleton pattern for showing toast notifications from anywhere
 * in the application. Toasts are displayed in a stack in the bottom-right corner.
 *
 * @example
 * ```typescript
 * // Show different types of toasts
 * UvmToastManager.success('Entry saved successfully');
 * UvmToastManager.error('Failed to load voicebank');
 * UvmToastManager.warning('Unsaved changes will be lost');
 * UvmToastManager.show('Processing...', 'primary', 5000);
 * ```
 *
 * @example
 * ```html
 * <!-- Add to app root (only once) -->
 * <uvm-toast-manager></uvm-toast-manager>
 * ```
 */
@customElement('uvm-toast-manager')
export class UvmToastManager extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: fixed;
      bottom: 1rem;
      right: 1rem;
      z-index: 9999;
      pointer-events: none;
    }

    .toast-stack {
      display: flex;
      flex-direction: column-reverse;
      gap: 0.5rem;
      max-width: 400px;
    }

    .toast {
      pointer-events: auto;
      animation: slideIn 0.2s ease-out;
    }

    .toast.closing {
      animation: slideOut 0.2s ease-in forwards;
    }

    @keyframes slideIn {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }

    @keyframes slideOut {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(100%);
        opacity: 0;
      }
    }

    sl-alert {
      --sl-spacing-large: 1rem;
    }

    sl-alert::part(base) {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    sl-alert::part(message) {
      font-size: 0.875rem;
    }
  `;

  /**
   * Singleton instance reference for static methods.
   */
  static instance: UvmToastManager | null = null;

  /**
   * Counter for generating unique toast IDs.
   */
  private static _nextId = 1;

  /**
   * Current list of visible toasts.
   */
  @state()
  private _toasts: Toast[] = [];

  /**
   * Set of toast IDs currently closing (for animation).
   */
  @state()
  private _closingToasts: Set<number> = new Set();

  connectedCallback(): void {
    super.connectedCallback();
    UvmToastManager.instance = this;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (UvmToastManager.instance === this) {
      UvmToastManager.instance = null;
    }
  }

  /**
   * Show a toast notification with custom parameters.
   *
   * @param message - Text to display
   * @param variant - Toast style variant
   * @param duration - Auto-dismiss time in ms (0 for no auto-dismiss)
   */
  static show(
    message: string,
    variant: 'primary' | 'success' | 'warning' | 'danger' | 'neutral' = 'primary',
    duration = 3000
  ): void {
    UvmToastManager.instance?.addToast({ message, variant, duration });
  }

  /**
   * Show a success toast notification.
   * Auto-dismisses after 3 seconds.
   *
   * @param message - Success message to display
   */
  static success(message: string): void {
    UvmToastManager.show(message, 'success', 3000);
  }

  /**
   * Show an error toast notification.
   * Does not auto-dismiss (must be manually closed).
   *
   * @param message - Error message to display
   */
  static error(message: string): void {
    UvmToastManager.show(message, 'danger', 0);
  }

  /**
   * Show a warning toast notification.
   * Auto-dismisses after 5 seconds.
   *
   * @param message - Warning message to display
   */
  static warning(message: string): void {
    UvmToastManager.show(message, 'warning', 5000);
  }

  /**
   * Show an info toast notification.
   * Auto-dismisses after 3 seconds.
   *
   * @param message - Info message to display
   */
  static info(message: string): void {
    UvmToastManager.show(message, 'primary', 3000);
  }

  /**
   * Add a toast to the display stack.
   */
  private addToast(config: Omit<Toast, 'id'>): void {
    const id = UvmToastManager._nextId++;
    const toast: Toast = { ...config, id };

    this._toasts = [...this._toasts, toast];

    // Set up auto-dismiss if duration is specified
    if (config.duration > 0) {
      setTimeout(() => {
        this._dismissToast(id);
      }, config.duration);
    }
  }

  /**
   * Start the dismiss animation and remove the toast.
   */
  private _dismissToast(id: number): void {
    // Add to closing set for animation
    this._closingToasts = new Set([...this._closingToasts, id]);

    // Remove after animation completes
    setTimeout(() => {
      this._toasts = this._toasts.filter((t) => t.id !== id);
      this._closingToasts = new Set([...this._closingToasts].filter((tid) => tid !== id));
    }, 200);
  }

  /**
   * Handle manual toast close (user clicked X).
   */
  private _onToastClose(id: number): void {
    this._dismissToast(id);
  }

  /**
   * Get the appropriate icon name for a toast variant.
   */
  private _getIcon(variant: Toast['variant']): string {
    switch (variant) {
      case 'success':
        return 'check-circle';
      case 'danger':
        return 'exclamation-octagon';
      case 'warning':
        return 'exclamation-triangle';
      case 'primary':
      case 'neutral':
      default:
        return 'info-circle';
    }
  }

  render() {
    return html`
      <div class="toast-stack">
        ${this._toasts.map(
          (toast) => html`
            <div class="toast ${this._closingToasts.has(toast.id) ? 'closing' : ''}">
              <sl-alert
                variant=${toast.variant}
                open
                closable
                @sl-after-hide=${() => this._onToastClose(toast.id)}
              >
                <sl-icon slot="icon" name=${this._getIcon(toast.variant)}></sl-icon>
                ${toast.message}
              </sl-alert>
            </div>
          `
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-toast-manager': UvmToastManager;
  }
}
