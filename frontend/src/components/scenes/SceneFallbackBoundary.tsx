import { Component, type ReactNode } from 'react';

/** Isolate decorative canvas/asset failures from the surrounding work controls. */
export class SceneFallbackBoundary extends Component<{
  children: ReactNode;
  fallback: ReactNode;
  onFailure?: () => void;
}, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure?.(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
