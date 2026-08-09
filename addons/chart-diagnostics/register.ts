import { registerChartExtension } from '../../src/chart/extensions';
import { RuntimeDiagnostics } from './RuntimeDiagnostics';
import './diagnostics.css';

registerChartExtension(
  'runtime-diagnostics',
  context => new RuntimeDiagnostics(context),
);
