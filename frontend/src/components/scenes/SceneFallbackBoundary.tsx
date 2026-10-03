import { Component, type ReactNode } from 'react';

/** Isolate decorative canvas/asset failures from the surrounding work controls. */
export class SceneFallbackBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
