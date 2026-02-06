import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import './uvm-sample-card.js';
import type { OtoEntry } from '../services/types.js';

/** Virtual scrolling configuration */
const VIRTUAL_SCROLL_CONFIG = {
  cardWidth: 120,
  cardHeight: 80,
  gap: 12,
  buffer: 10,
};

/**
 * Virtual scrolling grid view for voicebank samples.
 *
 * Renders sample cards in a CSS grid with virtual scrolling for performance.
 * Supports vim-style (hjkl) and arrow-key navigation.
 *
 * @fires sample-click - Fired when a sample card is clicked
 *   Detail: { filename: string }
 * @fires sample-select - Fired when a sample is activated (double-click or Enter)
 *   Detail: { filename: string }
 */
@customElement('uvm-sample-grid')
export class UvmSampleGrid extends LitElement {
  static styles = css`
    :host {
      display: block;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      position: relative;
    }

    .sample-cards-virtual {
      position: relative;
    }

    .sample-cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 12px;
      padding: 12px;
      position: absolute;
      width: calc(100% - 24px);
    }
  `;

  @property({ type: Array })
  samples: string[] = [];

  @property({ type: String })
  selectedSample: string | null = null;

  @property({ type: String })
  voicebankId = '';

  @property({ type: Object })
  sampleOtoMap: Map<string, boolean> = new Map();

  @property({ type: Object })
  sampleOtoEntryMap: Map<string, OtoEntry> = new Map();

  @state()
  private _selectedGridIndex = -1;

  @state()
  private _scrollTop = 0;

  @state()
  private _containerHeight = 0;

  @state()
  private _containerWidth = 0;

  private _resizeObserver: ResizeObserver | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this._setupResizeObserver();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._cleanupResizeObserver();
  }

  protected updated(changedProperties: Map<string, unknown>): void {
    // Reset grid selection when samples change
    if (changedProperties.has('samples')) {
      this._selectedGridIndex = -1;
    }

    // Sync selectedGridIndex from selectedSample property
    if (changedProperties.has('selectedSample') && this.selectedSample) {
      const idx = this.samples.indexOf(this.selectedSample);
      if (idx >= 0) {
        this._selectedGridIndex = idx;
      }
    }

    // Re-attach ResizeObserver when container appears
    if (this._containerHeight === 0) {
      this._setupResizeObserver();
    }
  }

  /**
   * Get the number of columns per row in the grid.
   */
  private _getColumnsPerRow(): number {
    if (this._containerWidth <= 0) {
      return 5;
    }
    const { cardWidth, gap } = VIRTUAL_SCROLL_CONFIG;
    const availableWidth = this._containerWidth - 24;
    return Math.max(1, Math.floor((availableWidth + gap) / (cardWidth + gap)));
  }

  /**
   * Navigate the grid using directional keys.
   * Called by the parent component's keyboard handler.
   */
  navigateGrid(dx: number, dy: number): void {
    if (this.samples.length === 0) return;

    const columnsPerRow = this._getColumnsPerRow();

    if (this._selectedGridIndex < 0) {
      this._selectedGridIndex = 0;
      this._emitClick(this.samples[0]);
      return;
    }

    const currentRow = Math.floor(this._selectedGridIndex / columnsPerRow);
    const currentCol = this._selectedGridIndex % columnsPerRow;

    let newRow = currentRow + dy;
    let newCol = currentCol + dx;

    // Handle wrap-around for horizontal movement
    if (dx !== 0 && dy === 0) {
      if (newCol < 0) {
        if (newRow > 0) {
          newRow--;
          newCol = columnsPerRow - 1;
        } else {
          newCol = 0;
        }
      } else if (newCol >= columnsPerRow) {
        newRow++;
        newCol = 0;
      }
    }

    // Clamp row
    const totalRows = Math.ceil(this.samples.length / columnsPerRow);
    newRow = Math.max(0, Math.min(totalRows - 1, newRow));

    let newIndex = newRow * columnsPerRow + newCol;
    newIndex = Math.max(0, Math.min(this.samples.length - 1, newIndex));

    if (newIndex !== this._selectedGridIndex) {
      this._selectedGridIndex = newIndex;
      this._emitClick(this.samples[newIndex]);
      this._scrollToSelectedCard();
    }
  }

  /**
   * Activate the currently selected sample (e.g., on Enter key).
   */
  activateSelected(): void {
    if (this._selectedGridIndex >= 0 && this._selectedGridIndex < this.samples.length) {
      this._emitSelect(this.samples[this._selectedGridIndex]);
    }
  }

  private _setupResizeObserver(): void {
    this._cleanupResizeObserver();

    this._resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        this._containerWidth = entry.contentRect.width;
        this._containerHeight = entry.contentRect.height;
      }
    });

    // Observe the host element itself
    this._resizeObserver.observe(this);
  }

  private _cleanupResizeObserver(): void {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }

  private _onScroll(e: Event): void {
    const container = e.target as HTMLElement;
    this._scrollTop = container.scrollTop;
  }

  private _scrollToSelectedCard(): void {
    if (this._selectedGridIndex < 0) return;

    const { cardHeight, gap } = VIRTUAL_SCROLL_CONFIG;
    const columnsPerRow = this._getColumnsPerRow();
    const row = Math.floor(this._selectedGridIndex / columnsPerRow);
    const rowTop = row * (cardHeight + gap) + 12;
    const rowBottom = rowTop + cardHeight;

    const scrollTop = this.scrollTop;
    const containerHeight = this.clientHeight;

    if (rowTop < scrollTop) {
      this.scrollTop = rowTop - 12;
    } else if (rowBottom > scrollTop + containerHeight) {
      this.scrollTop = rowBottom - containerHeight + 12;
    }
  }

  private _onCardClick(filename: string, index: number): void {
    this._selectedGridIndex = index;
    this._emitClick(filename);
  }

  private _emitClick(filename: string): void {
    this.dispatchEvent(
      new CustomEvent('sample-click', {
        detail: { filename },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _emitSelect(filename: string): void {
    this.dispatchEvent(
      new CustomEvent('sample-select', {
        detail: { filename },
        bubbles: true,
        composed: false,
      })
    );
  }

  render() {
    const { cardHeight, gap, buffer } = VIRTUAL_SCROLL_CONFIG;
    const columnsPerRow = this._getColumnsPerRow();
    const rowHeight = cardHeight + gap;
    const totalRows = Math.ceil(this.samples.length / columnsPerRow);
    const totalHeight = totalRows * rowHeight + 24;

    const visibleStart = Math.floor(this._scrollTop / rowHeight);
    const visibleEnd = Math.ceil((this._scrollTop + this._containerHeight) / rowHeight);
    const renderStart = Math.max(0, visibleStart - buffer);
    const renderEnd = Math.min(totalRows, visibleEnd + buffer);

    const startIndex = renderStart * columnsPerRow;
    const endIndex = Math.min(this.samples.length, renderEnd * columnsPerRow);
    const visibleSamples = this.samples.slice(startIndex, endIndex);

    const topOffset = renderStart * rowHeight + 12;

    return html`
      <div
        class="sample-cards-virtual"
        style="height: ${totalHeight}px;"
        @scroll=${this._onScroll}
        role="listbox"
        aria-label="Samples"
      >
        <div class="sample-cards-grid" style="top: ${topOffset}px;">
          ${visibleSamples.map((filename, i) => {
            const globalIndex = startIndex + i;
            const isSelected = this.selectedSample === filename || this._selectedGridIndex === globalIndex;
            return html`
              <uvm-sample-card
                filename=${filename}
                voicebankId=${this.voicebankId}
                ?hasOto=${this.sampleOtoMap.get(filename) || false}
                ?selected=${isSelected}
                otoOffset=${this.sampleOtoEntryMap.get(filename)?.offset ?? 0}
                otoConsonant=${this.sampleOtoEntryMap.get(filename)?.consonant ?? 0}
                otoCutoff=${this.sampleOtoEntryMap.get(filename)?.cutoff ?? 0}
                data-sample-filename=${filename}
                data-sample-index=${globalIndex}
                @sample-click=${() => this._onCardClick(filename, globalIndex)}
                @sample-dblclick=${() => this._emitSelect(filename)}
              ></uvm-sample-card>
            `;
          })}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-sample-grid': UvmSampleGrid;
  }
}
