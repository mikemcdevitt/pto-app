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
 * Colors/marks follow the site's dataviz conventions: one hue for a single
 * series (validated categorical slot 1 blue, #2a78d6), <=24px bars, 4px
 * rounded caps square at the baseline, 2px gaps between bars, value labeled
 * on the cap, hover tooltip, muted axis/gridlines.
 */
(function () {
  const API_URL_ATTR = "api-url";
  const DEFAULT_API_URL = "/api/grade-participation";

  const COLOR_BAR = "#2a78d6";
  const COLOR_BAR_HOVER = "#1c5cab";
  const COLOR_TEXT_PRIMARY = "#0b0b0b";
  const COLOR_TEXT_SECONDARY = "#52514e";
  const COLOR_TEXT_MUTED = "#898781";
  const COLOR_GRIDLINE = "#e1e0d9";
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
      const width = 560;
      const height = 320;
      const marginTop = 32;
      const marginBottom = 40;
      const marginLeft = 8;
      const marginRight = 8;
      const chartHeight = height - marginTop - marginBottom;
      const chartWidth = width - marginLeft - marginRight;

      const loadingOrEmpty = !grades || grades.length === 0;
      const n = loadingOrEmpty ? 6 : grades.length;
      const barSlot = chartWidth / n;
      const barWidth = Math.min(24, barSlot - 8);
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
                    rx="4"
                    ry="4"
                    fill="${COLOR_BAR}"
                    class="bar"
                  />
                  <text x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle"
                    font-size="13" font-weight="600" fill="${COLOR_TEXT_PRIMARY}"
                    font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">
                    ${g.percent}%${leader ? " 🏆" : ""}
                  </text>
                  <text x="${x + barWidth / 2}" y="${marginTop + chartHeight + 20}" text-anchor="middle"
                    font-size="13" fill="${COLOR_TEXT_MUTED}"
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
            padding: 8px 4px 0;
            font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
          }
          .title {
            font-size: 15px;
            font-weight: 600;
            color: ${COLOR_TEXT_PRIMARY};
            margin: 4px 4px 2px;
          }
          .subtitle {
            font-size: 12px;
            color: ${COLOR_TEXT_SECONDARY};
            margin: 0 4px 8px;
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
            padding: 40px 0;
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
                    <line x1="${marginLeft}" y1="${marginTop}" x2="${width - marginRight}" y2="${marginTop}" stroke="${COLOR_GRIDLINE}" stroke-width="1" />
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
