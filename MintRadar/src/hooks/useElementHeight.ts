import { useCallback, useState, useSyncExternalStore } from 'react'

function subscribe(node: HTMLElement | null, onStoreChange: () => void): () => void {
  if (!node) return () => {}
  const ro = new ResizeObserver(() => onStoreChange())
  ro.observe(node)
  return () => ro.disconnect()
}

/** Tracks an element's rendered height via ResizeObserver — content reflow,
 *  breakpoint changes and async data arriving all update it live. Returns a
 *  ref callback to attach to the element and its current height in px
 *  (null before the first measurement, e.g. during the initial render). */
export function useElementHeight<T extends HTMLElement>(): [(el: T | null) => void, number | null] {
  const [node, setNode] = useState<T | null>(null)
  const subscribeToNode = useCallback(
    (onStoreChange: () => void) => subscribe(node, onStoreChange),
    [node],
  )
  const getSnapshot = useCallback(
    () => (node ? Math.round(node.getBoundingClientRect().height) : null),
    [node],
  )
  const height = useSyncExternalStore(subscribeToNode, getSnapshot, () => null)
  return [setNode, height]
}
