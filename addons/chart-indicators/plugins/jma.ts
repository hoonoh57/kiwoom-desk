import { createJmaAnalysis } from '../../chart-analysis/vwapJma';
import type { IndicatorPlugin } from '../types';

const plugin: IndicatorPlugin = {
  id: 'jma',
  version: 1,
  label: 'Jurik 이동평균 (JMA)',
  parameters: [
    {
      key: 'period',
      label: '기간',
      type: 'integer',
      default: 14,
      min: 1,
      max: 10_000,
      step: 1,
    },
    {
      key: 'phase',
      label: 'Phase',
      type: 'integer',
      default: 50,
      min: -100,
      max: 100,
      step: 1,
    },
    {
      key: 'power',
      label: 'Power',
      type: 'integer',
      default: 2,
      min: 1,
      max: 10_000,
      step: 1,
    },
  ],
  outputs: [
    {
      id: 'value',
      label: 'JMA',
      type: 'line',
      pane: 'main',
      options: {
        title: 'JMA',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
      },
    },
  ],
  create: params => createJmaAnalysis(params),
};

export default plugin;
