import { createVwapAnalysis } from '../../chart-analysis/vwapJma';
import type { IndicatorPlugin } from '../types';

const plugin: IndicatorPlugin = {
  id: 'vwap',
  version: 1,
  label: 'VWAP',
  parameters: [
    { key: 'stdDev1', label: '표준편차 1', type: 'number', default: 1, min: 0, max: 100, step: 0.1 },
    { key: 'stdDev2', label: '표준편차 2', type: 'number', default: 2, min: 0, max: 100, step: 0.1 },
    { key: 'showValue', label: 'VWAP 표시', type: 'boolean', default: true },
    { key: 'showUpper1', label: 'Upper1 표시', type: 'boolean', default: true },
    { key: 'showLower1', label: 'Lower1 표시', type: 'boolean', default: true },
    { key: 'showUpper2', label: 'Upper2 표시', type: 'boolean', default: true },
    { key: 'showLower2', label: 'Lower2 표시', type: 'boolean', default: true },
  ],
  outputs: [
    {
      id: 'value',
      label: 'VWAP',
      type: 'line',
      pane: 'main',
      options: {
        title: 'VWAP',
        color: '#00E5FF',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
      },
    },
    {
      id: 'upper1',
      label: 'Upper1',
      type: 'line',
      pane: 'main',
      options: {
        title: 'VWAP +1σ',
        color: 'rgba(255,235,59,.32)',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      },
    },
    {
      id: 'lower1',
      label: 'Lower1',
      type: 'line',
      pane: 'main',
      options: {
        title: 'VWAP -1σ',
        color: 'rgba(255,235,59,.32)',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      },
    },
    {
      id: 'upper2',
      label: 'Upper2',
      type: 'line',
      pane: 'main',
      options: {
        title: 'VWAP +2σ',
        color: 'rgba(255,112,67,.20)',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      },
    },
    {
      id: 'lower2',
      label: 'Lower2',
      type: 'line',
      pane: 'main',
      options: {
        title: 'VWAP -2σ',
        color: 'rgba(255,112,67,.20)',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      },
    },
  ],
  create: params => createVwapAnalysis(params),
};

export default plugin;
