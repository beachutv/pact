'use client'

import { useState, useRef, useCallback } from 'react'

export function usePullToRefresh(onRefresh: () => Promise<void>) {
  const [refreshing, setRefreshing] = useState(false)
  const [pullY, setPullY] = useState(0)
  const touchStartY = useRef(0)
  const touchStartX = useRef(0)
  const isHorizontalSwipe = useRef(false)
  const directionLocked = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const doRefresh = useCallback(async () => {
    setRefreshing(true)
    await onRefresh()
    setRefreshing(false)
  }, [onRefresh])

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY
    touchStartX.current = e.touches[0].clientX
    isHorizontalSwipe.current = false
    directionLocked.current = false
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (refreshing) return

    const dx = e.touches[0].clientX - touchStartX.current
    const dy = e.touches[0].clientY - touchStartY.current

    // Lock direction after 8px of movement
    if (!directionLocked.current && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      directionLocked.current = true
      isHorizontalSwipe.current = Math.abs(dx) > Math.abs(dy)
    }

    // If horizontal swipe detected, don't activate pull-to-refresh
    if (isHorizontalSwipe.current) return

    const scrollParent = containerRef.current?.closest('main')
    if (scrollParent && scrollParent.scrollTop > 0) return
    if (dy > 0) setPullY(Math.min(dy * 0.5, 80))
  }, [refreshing])

  const onTouchEnd = useCallback(() => {
    if (pullY > 50) doRefresh()
    setPullY(0)
    isHorizontalSwipe.current = false
    directionLocked.current = false
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
