/** Semicircular 0–180° angle gauge with the exercise's rest and active zones marked. */
import type { RepThresholds } from "../core/repCounter";

const CX = 100;
const CY = 104;
const R = 84;

/** 0° sits at the left end of the arc, 180° at the right. */
function polar(angleDeg: number, radius = R): { x: number; y: number } {
  const t = Math.PI - (angleDeg * Math.PI) / 180;
  return { x: CX + radius * Math.cos(t), y: CY - radius * Math.sin(t) };
}

function arcPath(from: number, to: number): string {
  const a = polar(from);
  const b = polar(to);
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${R} ${R} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

export class Gauge {
  private readonly needle: SVGLineElement;
  private readonly zoneRest: SVGPathElement;
  private readonly zoneActive: SVGPathElement;
  private readonly ticks: SVGGElement;

  constructor(root: Element) {
    const q = <T extends Element>(sel: string) => {
      const el = root.querySelector<T>(sel);
      if (!el) throw new Error(`Gauge is missing ${sel}`);
      return el;
    };
    this.needle = q<SVGLineElement>("#gauge-needle");
    this.zoneRest = q<SVGPathElement>("#zone-rest");
    this.zoneActive = q<SVGPathElement>("#zone-active");
    this.ticks = q<SVGGElement>("#gauge-ticks");
  }

  setThresholds({ rest, active }: RepThresholds): void {
    const flex = active < rest;
    this.zoneRest.setAttribute("d", flex ? arcPath(rest, 180) : arcPath(0, rest));
    this.zoneActive.setAttribute("d", flex ? arcPath(0, active) : arcPath(active, 180));
    const ns = "http://www.w3.org/2000/svg";
    this.ticks.replaceChildren(
      ...[rest, active].map((deg) => {
        const p1 = polar(deg, R - 12);
        const p2 = polar(deg, R + 7);
        const line = document.createElementNS(ns, "line");
        line.setAttribute("x1", p1.x.toFixed(2));
        line.setAttribute("y1", p1.y.toFixed(2));
        line.setAttribute("x2", p2.x.toFixed(2));
        line.setAttribute("y2", p2.y.toFixed(2));
        line.setAttribute("class", "gauge-tick");
        return line;
      }),
    );
  }

  setAngle(angle: number | null): void {
    this.needle.classList.toggle("is-idle", angle === null);
    const p = polar(angle ?? 90, R - 16);
    this.needle.setAttribute("x2", p.x.toFixed(2));
    this.needle.setAttribute("y2", p.y.toFixed(2));
  }
}
