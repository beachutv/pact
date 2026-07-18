'use client'

import { useState, useRef, useCallback } from 'react'

export function usePullToRefresh(onRefresh: () => Promise<void>) {
  const [refreshing, setRefreshing] = useState(false)
  const [pullY, setPullY] = useState(0)
  const touchStartY = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const doRefresh = useCallback(async () => {
    setRefreshing(true)
    await onRefresh()
    setRefreshing(false)
  }, [onRefresh])

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (refreshing) return
    const scrollParent = containerRef.current?.closest('main')
    if (scrollParent && scrollParent.scrollTop > 0) return
    const dy = e.touches[0].clientY - touchStartY.current
    if (dy > 0) setPullY(Math.min(dy * 0.5, 80))
  }, [refreshing])

  const onTouchEnd = useCallback(() => {
    if (pullY > 50) doRefresh()
    setPullY(0)
  }, [pullY, doRefresh])

  const indicatorText = refreshing
    ? '⟳ Refreshing...'
    : pullY > 50
      ? '↓ Release to refresh'
      : '↓ Pull to refresh'

  return {
    containerRef,
    refreshing,
    pullY,
    indicatorText,
    touchHandlers: { onTouchStart, onTouchMove, onTouchEnd },
  }
}
