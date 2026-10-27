// Small SVG chart primitives. Colours come from CSS tokens so both themes read correctly.
const { useState } = React;

export function BarList({ data, onSelect, unit = 'records', max }) {
  const top = max || Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="barlist">
      {data.map((d) => (
        <li key={d.label}>
          <button type="button" className="barlist-row" onClick={() => onSelect && onSelect(d)} title={`${d.label}: ${d.value} ${unit}`}
            aria-label={`${d.label}: ${d.value} ${unit}. Open records`}>
            <span className="barlist-label">{d.label}</span>
            <span className="barlist-track"><span className="barlist-fill" style={{ width: (d.value / top) * 100 + '%' }} /></span>
            <span className="barlist-val num">{d.value}</span>
          </button>
        </li>
      ))}
      {!data.length && <li className="muted small">No records match these filters.</li>}
    </ul>
  );
}

export function TrendChart({ data, labels, onSelect }) {
  const [hover, setHover] = useState(null);
  const W = 560, H = 190, pl = 34, pr = 12, pt = 14, pb = 26;
  const max = Math.max(4, ...data);
  const niceMax = Math.ceil(max / 10) * 10 || 10;
  const x = (i) => pl + (i * (W - pl - pr)) / (data.length - 1);
  const y = (v) => pt + (1 - v / niceMax) * (H - pt - pb);
  const line = data.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  const area = `${line} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const ticks = [0, niceMax / 2, niceMax];
  const last = data.length - 1;
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`Ticket volume by month. Latest month ${data[last]} tickets.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pl} x2={W - pr} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pl - 6} y={y(t) + 4} className="axis" textAnchor="end">{t}</text>
          </g>
        ))}
        <path d={area} className="area" />
        <path d={line} className="line" fill="none" />
        {labels.map((l, i) => <text key={l} x={x(i)} y={H - 8} className="axis" textAnchor="middle">{l}</text>)}
        <circle cx={x(last)} cy={y(data[last])} r="4.5" className="endpoint" />
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pt} y2={y(0)} className="crosshair" />
            <circle cx={x(hover)} cy={y(data[hover])} r="4.5" className="endpoint" />
          </g>
        )}
        {data.map((v, i) => (
          <rect key={i} x={x(i) - (W - pl - pr) / (data.length - 1) / 2} y={pt} width={(W - pl - pr) / (data.length - 1)} height={H - pt - pb}
            fill="transparent" style={{ cursor: 'pointer' }} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            onClick={() => onSelect && onSelect(i)} />
        ))}
      </svg>
      {hover != null && (
        <div className="tooltip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <b>{labels[hover]}</b> {data[hover]} tickets
        </div>
      )}
      <div className="sr-only">
        {labels.map((l, i) => <button key={l} type="button" onClick={() => onSelect && onSelect(i)}>{l}: {data[i]} tickets</button>)}
      </div>
    </div>
  );
}

const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)'];

export function Donut({ data, onSelect, centerLabel }) {
  const total = data.reduce((a, d) => a + d.value, 0) || 1;
  let acc = 0;
  const R = 52, C = 2 * Math.PI * R;
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 140 140" width="150" height="150" role="img" aria-label="Root-cause distribution">
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--line)" strokeWidth="18" />
        {data.map((d, i) => {
          const len = (d.value / total) * C;
          const seg = (
            <circle key={d.label} cx="70" cy="70" r={R} fill="none" stroke={SERIES[i % SERIES.length]} strokeWidth="18"
              strokeDasharray={`${Math.max(0, len - 2)} ${C}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)"
              style={{ cursor: 'pointer' }} onClick={() => onSelect && onSelect(d)}><title>{d.label}: {d.value}</title></circle>
          );
          acc += len;
          return seg;
        })}
        <text x="70" y="68" textAnchor="middle" className="donut-num">{total === 1 && !data.length ? 0 : total}</text>
        <text x="70" y="86" textAnchor="middle" className="axis">{centerLabel}</text>
      </svg>
      <ul className="legend">
        {data.map((d, i) => (
          <li key={d.label}>
            <button type="button" onClick={() => onSelect && onSelect(d)}>
              <span className="swatch" style={{ background: SERIES[i % SERIES.length] }} />
              <span className="legend-label">{d.label}</span>
              <span className="num muted">{Math.round((d.value / total) * 100)}%</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StackBar({ data, onSelect }) {
  const total = data.reduce((a, d) => a + d.value, 0) || 1;
  return (
    <div>
      <div className="stack" role="img" aria-label="Resolution reuse">
        {data.map((d, i) => d.value > 0 && (
          <button key={d.label} type="button" className="stack-seg" style={{ width: (d.value / total) * 100 + '%', background: SERIES[i] }}
            title={`${d.label}: ${d.value}`} aria-label={`${d.label}: ${d.value}`} onClick={() => onSelect && onSelect(d)} />
        ))}
      </div>
      <ul className="legend legend-row">
        {data.map((d, i) => (
          <li key={d.label}>
            <button type="button" onClick={() => onSelect && onSelect(d)}>
              <span className="swatch" style={{ background: SERIES[i] }} /><span className="legend-label">{d.label}</span>
              <span className="num muted">{d.value}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
