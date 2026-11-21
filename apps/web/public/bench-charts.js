// Hover layer for the benchmark charts: the nearest point gets a tooltip (line: a crosshair too).
for (const svg of document.querySelectorAll("svg.bench-chart[data-points]")) {
  const pts = JSON.parse(svg.dataset.points);
  const frame = svg.closest(".bench-frame");
  const tip = document.createElement("div");
  tip.className = "bench-tip";
  tip.hidden = true;
  frame.append(tip);
  const hover = svg.querySelector(".bc-hover");
  const cross = hover?.querySelector(".bc-cross");
  const dot = hover?.querySelector(".bc-hdot");
  const show = (evt) => {
    const box = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const sx = box.width / vb.width;
    const px = (evt.clientX - box.left) / sx;
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.x - px) < Math.abs(best.x - px)) best = p;
    tip.innerHTML = `<b></b><span></span>`;
    tip.firstChild.textContent = best.value;
    tip.lastChild.textContent = best.label;
    const fb = frame.getBoundingClientRect();
    tip.style.left = `${box.left - fb.left + best.x * sx}px`;
    tip.style.top = `${box.top - fb.top + best.y * sx}px`;
    tip.hidden = false;
    if (hover) {
      hover.style.opacity = "1";
      cross.setAttribute("x1", best.x); cross.setAttribute("x2", best.x);
      dot.setAttribute("cx", best.x); dot.setAttribute("cy", best.y);
    }
  };
  const hide = () => { tip.hidden = true; if (hover) hover.style.opacity = "0"; };
  svg.addEventListener("pointermove", show);
  svg.addEventListener("pointerleave", hide);
}
