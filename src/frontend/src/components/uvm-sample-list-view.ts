import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/badge/badge.js';

/**
 * Compact list view for voicebank samples.
 *
 * Displays samples in a sorted, scrollable list with alias name,
 * filename, and oto status indicator.
 *
 * @fires sample-click - Fired when a sample is clicked
 *   Detail: { filename: string }
 * @fires sample-select - Fired when a sample is activated (Enter key)
 *   Detail: { filename: string }
 */
@customElement('uvm-sample-list-view')
export class UvmSampleListView extends LitElement {
  static styles = css`
    :host {
      display: block;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    }

    .sample-list {
      display: flex;
      flex-direction: column;
    }

    .sample-list-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 1rem;
      border-bottom: 1px solid #f3f4f6;
      cursor: pointer;
      transition: background-color 0.15s ease;
    }

    .sample-list-item:last-child {
      border-bottom: none;
    }

    .sample-list-item:hover {
      background-color: #f9fafb;
    }

    .sample-list-item:focus {
      outline: 2px solid #3b82f6;
      outline-offset: -2px;
    }

    .sample-list-item.selected {
      background-color: #eff6ff;
      border-left: 3px solid #3b82f6;
      padding-left: calc(1rem - 3px);
    }

    .sample-list-alias {
      font-size: 0.8125rem;
      font-weight: 500;
      color: #1f2937;
      min-width: 80px;
    }

    .sample-list-item.selected .sample-list-alias {
      color: #1d4ed8;
    }

    .sample-list-filename {
      flex: 1;
      font-size: 0.75rem;
      color: #6b7280;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .sample-list-status {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      flex-shrink: 0;
    }

    .sample-list-status sl-badge::part(base) {
      font-size: 0.625rem;
      padding: 0.125rem 0.375rem;
    }

    .sample-list-oto-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: #22c55e;
    }

    .sample-list-no-oto {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: #d1d5db;
    }
  `;

  @property({ type: Array })
  samples: string[] = [];

  @property({ type: String })
  selectedSample: string | null = null;

  @property({ type: Object })
  sampleOtoMap: Map<string, boolean> = new Map();

  /**
   * Strip .wav extension from filename for display.
   */
  private _displayName(filename: string): string {
    return filename.replace(/\.wav$/i, '');
  }

  /**
   * Get samples sorted alphabetically by display name.
   */
  private _getSortedSamples(): string[] {
    return [...this.samples].sort((a, b) =>
      this._displayName(a).localeCompare(this._displayName(b), undefined, { sensitivity: 'base' })
    );
  }

  private _onSampleClick(filename: string): void {
    this.dispatchEvent(
      new CustomEvent('sample-click', {
        detail: { filename },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onSampleKeyDown(e: KeyboardEvent, filename: string, sortedSamples: string[]): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.dispatchEvent(
        new CustomEvent('sample-select', {
          detail: { filename },
          bubbles: true,
          composed: true,
        })
      );
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const currentIndex = sortedSamples.indexOf(filename);
      const nextIndex = Math.min(sortedSamples.length - 1, currentIndex + 1);
      const nextSample = sortedSamples[nextIndex];
      if (nextSample) {
        this._onSampleClick(nextSample);
        this._focusSampleItem(nextSample);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const currentIndex = sortedSamples.indexOf(filename);
      const prevIndex = Math.max(0, currentIndex - 1);
      const prevSample = sortedSamples[prevIndex];
      if (prevSample) {
        this._onSampleClick(prevSample);
        this._focusSampleItem(prevSample);
      }
    }
  }

  private _focusSampleItem(filename: string): void {
    const item = this.shadowRoot?.querySelector(
      `[data-sample-filename="${filename}"]`
    ) as HTMLElement | null;
    item?.focus();
  }

  render() {
    const sortedSamples = this._getSortedSamples();

    return html`
      <div class="sample-list" role="listbox" aria-label="Samples">
        ${sortedSamples.map(
          (filename) => html`
            <div
              class="sample-list-item ${this.selectedSample === filename ? 'selected' : ''}"
              role="option"
              aria-selected=${this.selectedSample === filename}
              tabindex="0"
              data-sample-filename=${filename}
              @click=${() => this._onSampleClick(filename)}
              @keydown=${(e: KeyboardEvent) => this._onSampleKeyDown(e, filename, sortedSamples)}
            >
              <span class="sample-list-alias">${this._displayName(filename)}</span>
              <span class="sample-list-filename">${filename}</span>
              <div class="sample-list-status">
                ${this.sampleOtoMap.get(filename)
                  ? html`
                      <sl-tooltip content="Has oto entry">
                        <span class="sample-list-oto-dot"></span>
                      </sl-tooltip>
                    `
                  : html`
                      <sl-tooltip content="No oto entry">
                        <span class="sample-list-no-oto"></span>
                      </sl-tooltip>
                    `}
              </div>
            </div>
          `
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-sample-list-view': UvmSampleListView;
  }
}
