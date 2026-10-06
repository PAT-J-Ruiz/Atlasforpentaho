/**
 * export-excel.js — One CSV, one row per execution, ready to filter in Excel
 *
 * Semicolon-separated with a UTF-8 BOM: Excel in Spanish locales splits on
 * ";" and only reads accents correctly with the BOM.
 */

'use strict';

const PKAExportExcel = (() => {

  const COLUMNS = [
    ['Job raíz',        e => e.rootJob],
    ['Thread',          e => e.thread],
    ['Inicio',          e => PKAReportData.fmtDateTime(e.startTime)],
    ['Fin',             e => PKAReportData.fmtDateTime(e.endTime)],
    ['Duración',        e => PKAReportData.fmtDuration(e.duration)],
    ['Duración (seg)',  e => e.duration ? (e.duration / 1000).toFixed(1).replace('.', ',') : ''],
    ['Estado',          e => PKAReportData.statusLabel(e)],
    ['Incidentes de error', e => e.hasError ? (e.errorCount || 1) : 0],
    ['Primer error',    e => e.firstErrorMessage || ''],
  ];

  async function exportKPIs() {
    const { executions, fileName } = await PKAReportData.load();
    if (executions.length === 0) { alert('No hay datos para exportar. Carga un log primero.'); return; }

    const rows = [...executions].sort((a, b) =>
      (a.rootJob || '').localeCompare(b.rootJob || '') || (a.startTime || 0) - (b.startTime || 0));

    const lines = [
      COLUMNS.map(([h]) => _cell(h)).join(';'),
      ...rows.map(e => COLUMNS.map(([, get]) => _cell(get(e))).join(';')),
    ];

    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${PKAReportData.fileBase(fileName)}-ejecuciones.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function _cell(v) {
    const s = String(v ?? '').replace(/\r?\n/g, ' ').replace(/"/g, '""');
    return `"${s}"`;
  }

  return { exportKPIs };
})();

if (typeof window !== 'undefined') window.PKAExportExcel = PKAExportExcel;
