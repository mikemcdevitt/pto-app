/**
 * <grade-chart> — a self-contained Web Component that fetches
 * /api/grade-participation from pto-app and renders a single-series column
 * chart of donation participation % by grade.
 *
 * Served by pto-app itself at /grade-chart-element.js (this file lives in
 * public/). Register it in the Wix Editor as a Custom Element with tag
 * "grade-chart" pointing at that URL. See the setup doc for exact steps.
 *
 * No external dependencies (no Chart.js/CDN) — plain SVG, so nothing extra
 * has to load inside Wix's embed.
 *
 * Compact, coarse-grained layout: at most 6 columns (one per grade K-5), so
 * there's no need for a fine-grained percentage axis or extra reference
 * lines — just a baseline, bars, and their labels. Red accent per request.
 */
(function () {
  const API_URL_ATTR = "api-url";
  const DEFAULT_API_URL = "/api/grade-participation";

  const COLOR_BAR = "#c0392b";
  const COLOR_BAR_HOVER = "#96291d";
  const COLOR_TEXT_PRIMARY = "#0b0b0b";
  const COLOR_TEXT_SECONDARY = "#52514e";
  const COLOR_TEXT_MUTED = "#898781";
  const COLOR_BASELINE = "#c3c2b7";
  const COLOR_SURFACE = "#fcfcfb";

  class GradeChart extends HTMLElement {
    connectedCallback() {
      this.attachShadow({ mode: "open" });
      this.render(null);
      this.load();
    }

    get apiUrl() {
      return this.getAttribute(API_URL_ATTR) || DEFAULT_API_URL;
    }

    async load() {
      try {
        const res = await fetch(this.apiUrl, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this.render(data.grades || []);
      } catch (err) {
        this.renderError();
      }
    }

    renderError() {
      this.shadowRoot.innerHTML = `
        <div style="font: 14px system-ui, -apple-system, 'Segoe UI', sans-serif; color: ${COLOR_TEXT_SECONDARY}; padding: 16px;">
          Couldn't load participation data right now.
        </div>`;
    }

    render(grades) {
      // Compact footprint: shorter and narrower than the original chart,
      // and no top gridline -- with only up to 6 categories and whole-
      // percent values, a single baseline is all the reference the reader
      // needs.
      const width = 480;
      const height = 220;
      const marginTop = 26;
      const marginBottom = 30;
      const marginLeft = 8;
      const marginRight = 8;
      const chartHeight = height - marginTop - marginBottom;
      const chartWidth = width - marginLeft - marginRight;

      const loadingOrEmpty = !grades || grades.length === 0;
      const n = loadingOrEmpty ? 6 : grades.length;
      const barSlot = chartWidth / n;
      const barWidth = Math.min(32, barSlot - 8);
      const gap = 2;

      const maxPercent = 100;

      const bars = loadingOrEmpty
        ? ""
        : grades
            .map((g, i) => {
              const x = marginLeft + i * barSlot + (barSlot - barWidth) / 2;
              const barHeight = Math.max(0, (g.percent / maxPercent) * chartHeight);
              const y = marginTop + chartHeight - barHeight;
              const leader =
                grades.every((o) => o.percent <= g.percent) && g.percent > 0;
              const label = g.label || g.grade;

              return `
                <g class="bar-group" data-grade="${label}" data-percent="${g.percent}" data-donating="${g.donating}" data-total="${g.total}">
                  <rect
                    x="${x + gap / 2}"
                    y="${y}"
                    width="${Math.max(0, barWidth - gap)}"
                    height="${barHeight}"
                    rx="3"
                    ry="3"
                    fill="${COLOR_BAR}"
                    class="bar"
                  />
                  <text x="${x + barWidth / 2}" y="${y - 6}" text-anchor="middle"
                    font-size="12" font-weight="600" fill="${COLOR_TEXT_PRIMARY}"
                    font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">
                    ${g.percent}%${leader ? " 🏆" : ""}
                  </text>
                  <text x="${x + barWidth / 2}" y="${marginTop + chartHeight + 16}" text-anchor="middle"
                    font-size="12" fill="${COLOR_TEXT_MUTED}"
                    font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">
                    ${label}
                  </text>
                </g>`;
            })
            .join("");

      this.shadowRoot.innerHTML = `
        <style>
          .viz-root {
            background: ${COLOR_SURFACE};
            border-radius: 8px;
            padding: 6px 4px 0;
            font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
          }
          .title {
            font-size: 14px;
            font-weight: 600;
            color: ${COLOR_TEXT_PRIMARY};
            margin: 4px 4px 1px;
          }
          .subtitle {
            font-size: 11px;
            color: ${COLOR_TEXT_SECONDARY};
            margin: 0 4px 6px;
          }
          .bar { transition: fill 0.12s ease; cursor: pointer; }
          .bar-group:hover .bar { fill: ${COLOR_BAR_HOVER}; }
          .tooltip {
            position: absolute;
            pointer-events: none;
            background: ${COLOR_TEXT_PRIMARY};
            color: #fff;
            font-size: 12px;
            padding: 6px 9px;
            border-radius: 6px;
            opacity: 0;
            transform: translate(-50%, -100%);
            white-space: nowrap;
            transition: opacity 0.1s ease;
          }
          .chart-wrap { position: relative; }
          .loading {
            font-size: 13px;
            color: ${COLOR_TEXT_MUTED};
            padding: 24px 0;
            text-align: center;
          }
        </style>
        <div class="viz-root">
          <div class="title">Grade Challenge — participation by grade</div>
          <div class="subtitle">Percent of families who've given to the Annual Appeal</div>
          <div class="chart-wrap">
            ${
              loadingOrEmpty
                ? `<div class="loading">Loading…</div>`
                : `<svg viewBox="0 0 ${width} ${height}" width="100%" height="auto" role="img" aria-label="Donation participation percentage by grade">
                    <line x1="${marginLeft}" y1="${marginTop + chartHeight}" x2="${width - marginRight}" y2="${marginTop + chartHeight}" stroke="${COLOR_BASELINE}" stroke-width="1" />
                    ${bars}
                  </svg>
                  <div class="tooltip" id="tooltip"></div>`
            }
          </div>
        </div>
      `;

      if (!loadingOrEmpty) this.wireTooltip();
    }

    wireTooltip() {
      const tooltip = this.shadowRoot.getElementById("tooltip");
      const svg = this.shadowRoot.querySelector("svg");
      this.shadowRoot.querySelectorAll(".bar-group").forEach((group) => {
        group.addEventListener("mousemove", (e) => {
          const rect = svg.getBoundingClientRect();
          const { grade, percent, donating, total } = group.dataset;
          tooltip.textContent = `${grade}: ${percent}% (${donating} of ${total} families)`;
          tooltip.style.left = `${e.clientX - rect.left}px`;
          tooltip.style.top = `${e.clientY - rect.top - 8}px`;
          tooltip.style.opacity = "1";
        });
        group.addEventListener("mouseleave", () => {
          tooltip.style.opacity = "0";
        });
      });
    }
  }

  customElements.define("grade-chart", GradeChart);
})();
