import { registerChartExtension } from '../../chart/extensions';
import { IndicatorHost } from './IndicatorHost';
import './indicator.css';

registerChartExtension(
  'indicators',
  context => new IndicatorHost(context),
);
