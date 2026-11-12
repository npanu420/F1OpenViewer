import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { solveTiling, type TileFrame } from './autoTiling';

const TILE_SPACING = 6;
/** A new tile count is committed once the area has asked for it this long (also mid-resize). */
const COUNT_COMMIT_DELAY_MS = 240;
/** Size changes closer together than this are one continuous resize (window edge drag). */
const LIVE_RESIZE_GAP_MS = 150;
/** A drag is over once the size has been still this long; tiles are added or dropped only then. */
const RESIZE_SETTLE_MS = 280;
/**
 * While dragging, the arrangement on screen stays while it covers within this of the best one.
 * Generous on purpose: the best arrangement is applied anyway, once, when the edge is let go.
 */
const DRAG_KEEP_TOLERANCE = 0.25;
/**
 * Undoing a count change this soon needs the area to have changed by at least REVERT_MIN_CHANGE.
 * A new stream can resize something around the grid (a toolbar that wraps), which would otherwise
 * drop that same stream again, forever.
 */
const REVERT_GUARD_MS = 6000;
const REVERT_MIN_CHANGE = 0.12;
/** Critically damped spring of a re-arrangement (rad/s): settles in about 0.5 s, no overshoot. */
const SPRING_OMEGA = 12;
/** Slower spring for the rare re-arrangement while an edge is still being dragged (about 0.7 s). */
const DRAG_SPRING_OMEGA = 8;
/** Below this offset (px) and speed (px/s) a tile is at rest. */
const REST_OFFSET = 0.25;
const REST_SPEED = 4;

/** Streams the user picked stay on screen while their tiles are at least this wide. */
const FIXED_MIN_TILE_WIDTH = 150;

const TILE_ENTER = { opacity: 1, scale: 1 };
const TILE_EXIT = { opacity: 0, scale: 0.94 };
const TILE_TRANSITION = { duration: 0.26, ease: [0.22, 1, 0.36, 1] as const };

type Quad = [number, number, number, number];

/** A tile is drawn at `target + offset`; the spring pulls the offset to zero. */
interface TileMotion {
  target: TileFrame;
  offset: Quad;
  velocity: Quad;
  moving: boolean;
}

function applyFrame(el: HTMLElement, m: TileMotion) {
  const { target: f, offset: o } = m;
  el.style.transform = `translate3d(${f.x + o[0]}px, ${f.y + o[1]}px, 0)`;
  el.style.width = `${Math.max(0, f.width + o[2])}px`;
  el.style.height = `${Math.max(0, f.height + o[3])}px`;
}

interface AutoTileGridProps {
  slotIds: string[];
  maxTiles: number;
  preferredCount: number;
  /**
   * Tile count picked by hand. Kept when it fills the area well, otherwise a few more tiles are
   * shown so ultrawide windows are not left half empty. Never fewer.
   */
  fixedCount?: number | null;
  onCountChange: (count: number) => void;
  renderTile: (slotId: string) => React.ReactNode;
}

/**
 * Exact-aspect automatic tiling. While the window edge is dragged the tiles follow it exactly.
 * When the arrangement itself changes, each tile keeps its on-screen frame as an offset from the
 * new one and a spring settles that offset to zero, so a change that starts mid-drag or gets
 * interrupted never jumps.
 */
export function AutoTileGrid({ slotIds, maxTiles, preferredCount, fixedCount = null, onCountChange, renderTile }: AutoTileGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const continuousRef = useRef(false);
  /** A window edge is being dragged: hold the tile count and arrangement until it stops. */
  const [resizing, setResizing] = useState(false);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let last = { width: 0, height: 0 };
    let lastChange = -Infinity;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (last.width === width && last.height === height) return;
      const now = performance.now();
      // Isolated changes (dock toggle) animate; a rapid stream of them is a drag and just tracks.
      continuousRef.current = last.width > 0 && now - lastChange < LIVE_RESIZE_GAP_MS;
      lastChange = now;
      last = { width, height };
      setSize(last);
      if (continuousRef.current) {
        setResizing(true);
        clearTimeout(settle);
        settle = setTimeout(() => setResizing(false), RESIZE_SETTLE_MS);
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => {
      observer.disconnect();
      clearTimeout(settle);
    };
  }, []);

  const ideal = useMemo(() => {
    const limit = Math.max(1, maxTiles);
    if (fixedCount != null) {
      const wanted = Math.min(limit, Math.max(1, fixedCount));
      const chosen = solveTiling({
        ...size, spacing: TILE_SPACING, maxTiles: limit, preferredCount: wanted, minCount: wanted, minTileWidth: FIXED_MIN_TILE_WIDTH,
      });
      if (chosen && chosen.frames.length >= wanted) return chosen;
    }
    return solveTiling({ ...size, spacing: TILE_SPACING, maxTiles: limit, preferredCount });
  }, [size, maxTiles, preferredCount, fixedCount]);
  const shownFamilyRef = useRef<string | null>(null);
  const shown = useMemo(
    () =>
      slotIds.length === 0
        ? null
        : solveTiling({
          ...size, spacing: TILE_SPACING, maxTiles: Math.max(1, maxTiles), count: slotIds.length,
          keepFamily: resizing ? shownFamilyRef.current : null, keepTolerance: DRAG_KEEP_TOLERANCE,
        }),
    [size, maxTiles, slotIds.length, resizing]
  );
  shownFamilyRef.current = shown?.family ?? null;

  const onCountChangeRef = useRef(onCountChange);
  onCountChangeRef.current = onCountChange;
  const committedMaxTilesRef = useRef(maxTiles);
  const idealCount = ideal?.frames.length ?? 0;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const lastCommitRef = useRef<{ from: number; to: number; at: number; width: number; height: number } | null>(null);
  useEffect(() => {
    // A changed stream list (session loaded) is not a resize: apply its count right away.
    const streamsChanged = committedMaxTilesRef.current !== maxTiles;
    committedMaxTilesRef.current = maxTiles;
    if (idealCount === 0 || idealCount === slotIds.length) return;
    const commit = () => {
      const { width, height } = sizeRef.current;
      lastCommitRef.current = { from: slotIds.length, to: idealCount, at: performance.now(), width, height };
      onCountChangeRef.current(idealCount);
    };
    if (slotIds.length === 0 || streamsChanged) {
      commit();
      return;
    }
    // Mid-drag, tiles neither pop in nor out: the count follows once the edge is let go.
    if (resizing) return;
    const last = lastCommitRef.current;
    if (last && last.to === slotIds.length && last.from === idealCount && performance.now() - last.at < REVERT_GUARD_MS) {
      const { width, height } = sizeRef.current;
      const changed = Math.max(Math.abs(width - last.width) / last.width, Math.abs(height - last.height) / last.height);
      if (changed < REVERT_MIN_CHANGE) return;
    }
    // Short hold: crossing a threshold back and forth must not start and stop streams.
    const id = setTimeout(commit, COUNT_COMMIT_DELAY_MS);
    return () => clearTimeout(id);
  }, [idealCount, slotIds.length, maxTiles, resizing]);

  // A collapsed area (hidden parent) must not unmount the tiles: their players would reload.
  const lastFramesRef = useRef<TileFrame[]>([]);
  if (shown) lastFramesRef.current = shown.frames;
  const frames = slotIds.length === 0 ? [] : lastFramesRef.current;
  const family = shown?.family ?? null;

  const elementsRef = useRef(new Map<string, HTMLDivElement>());
  const motionsRef = useRef(new Map<string, TileMotion>());
  const rafRef = useRef(0);
  const lastTickRef = useRef(0);
  const reducedMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
    []
  );

  const omegaRef = useRef(SPRING_OMEGA);
  omegaRef.current = resizing ? DRAG_SPRING_OMEGA : SPRING_OMEGA;
  const tick = useCallback((now: number) => {
    const dt = Math.min(0.05, Math.max(0, (now - lastTickRef.current) / 1000));
    lastTickRef.current = now;
    const omega = omegaRef.current;
    const decay = Math.exp(-omega * dt);
    let active = false;
    for (const [slotId, m] of motionsRef.current) {
      if (!m.moving) continue;
      let rest = true;
      for (let i = 0; i < 4; i++) {
        const c = m.velocity[i] + omega * m.offset[i];
        const offset = (m.offset[i] + c * dt) * decay;
        const velocity = (m.velocity[i] - c * omega * dt) * decay;
        m.offset[i] = offset;
        m.velocity[i] = velocity;
        if (Math.abs(offset) > REST_OFFSET || Math.abs(velocity) > REST_SPEED) rest = false;
      }
      if (rest) {
        m.offset = [0, 0, 0, 0];
        m.velocity = [0, 0, 0, 0];
        m.moving = false;
      } else {
        active = true;
      }
      const el = elementsRef.current.get(slotId);
      if (el) applyFrame(el, m);
    }
    rafRef.current = active ? requestAnimationFrame(tick) : 0;
  }, []);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // Stable ref per slot: an inline callback would detach and re-attach the element every render.
  const tileRefsRef = useRef(new Map<string, (el: HTMLDivElement | null) => void>());
  const tileRef = (slotId: string) => {
    let ref = tileRefsRef.current.get(slotId);
    if (!ref) {
      ref = (el) => {
        if (el) {
          elementsRef.current.set(slotId, el);
        } else {
          elementsRef.current.delete(slotId);
          motionsRef.current.delete(slotId);
        }
      };
      tileRefsRef.current.set(slotId, ref);
    }
    return ref;
  };

  // Frames are written straight to the DOM before paint; the spring owns them, not React styles.
  const previousRef = useRef({ size, family, count: 0 });
  useLayoutEffect(() => {
    const previous = previousRef.current;
    const count = Math.min(slotIds.length, frames.length);
    // Same arrangement, window edge being dragged: follow exactly. Anything else glides.
    const track =
      reducedMotion ||
      (previous.size !== size && continuousRef.current && previous.family === family && previous.count === count);
    previousRef.current = { size, family, count };
    let start = false;
    for (let index = 0; index < count; index++) {
      const slotId = slotIds[index];
      const el = elementsRef.current.get(slotId);
      if (!el) continue;
      const target = frames[index];
      let m = motionsRef.current.get(slotId);
      if (!m) {
        m = { target, offset: [0, 0, 0, 0], velocity: [0, 0, 0, 0], moving: false };
        motionsRef.current.set(slotId, m);
      } else if (m.target !== target) {
        const from = m.target;
        if (!track) {
          m.offset[0] += from.x - target.x;
          m.offset[1] += from.y - target.y;
          m.offset[2] += from.width - target.width;
          m.offset[3] += from.height - target.height;
          m.moving = m.offset.some((v) => Math.abs(v) > REST_OFFSET) || m.moving;
        }
        m.target = target;
      }
      if (m.moving) start = true;
      applyFrame(el, m);
    }
    if (start && rafRef.current === 0) {
      lastTickRef.current = performance.now();
      rafRef.current = requestAnimationFrame(tick);
    }
  });

  return (
    <div ref={containerRef} className="auto-tile-grid">
      <AnimatePresence initial={false}>
        {slotIds.slice(0, frames.length).map((slotId) => (
          <div key={slotId} ref={tileRef(slotId)} className="auto-tile">
            <motion.div
              className="h-full w-full"
              initial={TILE_EXIT}
              animate={TILE_ENTER}
              exit={TILE_EXIT}
              transition={TILE_TRANSITION}
            >
              {renderTile(slotId)}
            </motion.div>
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
