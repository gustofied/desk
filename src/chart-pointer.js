// Safari misaligns SVG pointer coordinates when this article's root zoom is
// active. Keep hover selection data-driven: each observation owns a hit zone
// and is selected on pointerenter. Do not replace this with d3.pointer,
// clientX/clientY, getScreenCTM, or root-SVG coordinate conversion.
export function horizontalHitZones(values, position, width) {
  const maximum = Math.max(0, Number(width) || 0);
  const zoneCount = Math.min(
    values.length,
    Math.max(1, Math.round(maximum)),
  );
  const sampledValues = zoneCount === values.length
    ? values.map((value, index) => ({ value, index }))
    : Array.from({ length: zoneCount }, (_, sampleIndex) => {
        const index = zoneCount === 1
          ? values.length - 1
          : Math.round((sampleIndex * (values.length - 1)) / (zoneCount - 1));
        return { value: values[index], index };
      });
  const points = sampledValues.map(({ value, index }) => ({
    value,
    index,
    position: clamp(Number(position(value, index)) || 0, 0, maximum),
  }));

  return points.map((point, index) => {
    const previous = points[index - 1]?.position ?? 0;
    const next = points[index + 1]?.position ?? maximum;
    const start = index === 0 ? 0 : (previous + point.position) / 2;
    const end =
      index === points.length - 1 ? maximum : (point.position + next) / 2;

    return {
      ...point,
      x: start,
      width: Math.max(0, end - start),
    };
  });
}

export function positionSvgTooltip({
  tooltipNode,
  chartNode,
  svgNode,
  svgX,
  svgY,
}) {
  if (!tooltipNode || !chartNode || !svgNode) return;

  const chartRect = chartNode.getBoundingClientRect();
  const chartWidth = Math.max(1, chartNode.clientWidth || chartRect.width);
  const chartHeight = Math.max(1, chartNode.clientHeight || chartRect.height);
  const scaleX = chartRect.width / chartWidth || 1;
  const scaleY = chartRect.height / chartHeight || 1;
  const anchor = svgToClientPoint(svgX, svgY, svgNode);
  const anchorX = (anchor.x - chartRect.left) / scaleX;
  const anchorY = (anchor.y - chartRect.top) / scaleY;
  const tooltipWidth =
    tooltipNode.offsetWidth || tooltipNode.getBoundingClientRect().width / scaleX;
  const tooltipHeight =
    tooltipNode.offsetHeight || tooltipNode.getBoundingClientRect().height / scaleY;
  const gutter = 13;
  const edge = 8;
  const preferredLeft =
    anchorX + tooltipWidth + gutter + edge > chartWidth
      ? anchorX - tooltipWidth - gutter
      : anchorX + gutter;
  const left = clamp(preferredLeft, edge, chartWidth - tooltipWidth - edge);
  const top = clamp(
    anchorY - tooltipHeight / 2,
    edge,
    chartHeight - tooltipHeight - edge,
  );

  tooltipNode.style.left = `${left}px`;
  tooltipNode.style.top = `${top}px`;
}

function svgToClientPoint(svgX, svgY, svgNode) {
  const screenMatrix = svgNode.getScreenCTM?.();
  if (screenMatrix) {
    const point = new DOMPoint(svgX, svgY).matrixTransform(screenMatrix);
    return { x: point.x, y: point.y };
  }

  const geometry = svgGeometry(svgNode);

  return {
    x: geometry.left + (svgX - geometry.originX) * geometry.scale,
    y: geometry.top + (svgY - geometry.originY) * geometry.scale,
  };
}

function svgGeometry(svgNode) {
  const rect = svgNode.getBoundingClientRect();
  const viewBox = svgNode.viewBox?.baseVal;
  const width = Math.max(1, viewBox?.width || svgNode.clientWidth || rect.width);
  const height = Math.max(
    1,
    viewBox?.height || svgNode.clientHeight || rect.height,
  );
  const originX = viewBox?.x || 0;
  const originY = viewBox?.y || 0;
  const scale = Math.min(rect.width / width, rect.height / height) || 1;
  const renderedWidth = width * scale;
  const renderedHeight = height * scale;

  return {
    originX,
    originY,
    scale,
    left: rect.left + (rect.width - renderedWidth) / 2,
    top: rect.top + (rect.height - renderedHeight) / 2,
  };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(Math.max(minimum, maximum), value));
}
