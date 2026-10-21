/**
 * 全局与组件级 React 错误边界（Error Boundary）。
 * 捕获子组件渲染期间的不可预期异常，展示优雅的降级 UI 并支持重试，防止整屏白屏。
 */

import { AlertTriangle, RefreshCw } from 'lucide-react-native';
import { Component, useMemo, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from './Buttons';
import { sizing, spacing, workspaceTheme, type WorkspaceColors } from './tokens';
import { useTheme } from '../theme/ThemeProvider';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  title?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo);
  }

  reset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback(this.state.error, this.reset);
      }
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return <ErrorFallback title={this.props.title ?? '组件显示异常'} error={this.state.error} reset={this.reset} />;
    }

    return this.props.children;
  }
}

/** 函数组件读取主题，错误边界本身仍只承担 React 异常隔离。 */
function ErrorFallback({ title, error, reset }: { title: string; error: Error; reset: () => void }) {
  const { colors } = useTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  return <View style={styles.container}>
          <View style={styles.card}>
            <View style={styles.header}>
              <AlertTriangle size={sizing[20]} color={colors.danger} />
              <Text style={styles.title}>{title}</Text>
            </View>
            <Text style={styles.message} numberOfLines={3}>
              {error.message || '发生未知错误'}
            </Text>
            <View style={styles.actions}>
              <Button small icon={RefreshCw} onPress={reset}>
                重试
              </Button>
            </View>
          </View>
        </View>;
}

const createStyles = (colors: WorkspaceColors) => StyleSheet.create({
  container: {
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '100%',
    padding: spacing.lg,
    borderRadius: workspaceTheme.radius.card,
    backgroundColor: colors.dangerSoft,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    ...workspaceTheme.typography.itemTitle,
    fontWeight: '600',
    color: colors.danger,
  },
  message: {
    ...workspaceTheme.typography.caption,
    color: colors.muted,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.xs,
  },
});
