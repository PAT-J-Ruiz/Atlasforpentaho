# Atlas for Pentaho

Portal offline para consultar los procesos de Pentaho (catálogo, linaje, indicadores) y cruzarlos con los logs de ejecución.
Todo corre en el navegador: no hay servidor y no se envía nada a ninguna parte.

## Uso

1. Abre el sitio (GitHub Pages) o `index.html`.
2. Carga el índice del catálogo, una sola vez por navegador:
   - **Cargar un índice existente**: selecciona el archivo `indice.js` que comparte el equipo, o
   - **Generar índice**: a partir del HOME, los properties y el Excel de calendarización.
3. El índice queda guardado en tu navegador. En **Logs** cargas el log del servidor y se cruza con el catálogo.

## Módulos

- **Catálogo**: procesos y masters con su árbol de ejecución, calendario, bases de datos y archivos.
- **Operación**: logs de Pentaho y ejecuciones del día cruzadas con el catálogo.
- **Análisis**: indicadores (carga por BD, dependencias, riesgo, ventana horaria, higiene) y comparación entre HOME.

## Datos

`data/indice.js` **no está en este repositorio** a propósito: contiene nombres de servidores, bases de datos, SQL, rutas y correos internos.
Compártelo solo por los canales internos (SharePoint u OneDrive del equipo).

## Estructura

```
index.html
css/          estilos
js/core       indexador del HOME y lector de Excel
js/catalog    catálogo, indicadores, ejecuciones del día
js/logs       motor de análisis de logs de Pentaho
data/         aplicativos.js (catálogo editable de aplicativos)
```
