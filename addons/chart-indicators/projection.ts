import type {
  IndicatorInstanceConfig,
  IndicatorOutputDef,
} from './types';

/**
 * Add-on-owned pure projection helper.
 *
 * Runtime/Core never interpret nested output state. The Indicator add-on owns
 * how committed style[outputId] state is projected over plugin output defaults.
 */
export function indicatorSeriesOptions(
  output: IndicatorOutputDef,
  config: IndicatorInstanceConfig,
): Record<string, unknown> {
  return {
    ...(output.options ?? {}),
    ...(config.style?.[output.id] ?? {}),
  };
}
