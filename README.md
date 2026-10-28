# Seguimiento de pedidos

Tablero compartido para registrar pedidos, responsables, estados, avances y adjuntos. El sitio se publica como una página estática y Supabase guarda los datos.

## Publicación con GitHub Pages

1. Crear un repositorio llamado `seguimiento-pedidos`.
2. Subir al nivel principal `index.html`, `app.js`, `config.js` y `.nojekyll`.
3. En GitHub, abrir **Settings → Pages** y elegir la rama principal y la carpeta raíz como fuente de publicación.
4. Esperar a que GitHub Pages publique el sitio. La URL será `https://<usuario>.github.io/seguimiento-pedidos/`.
5. En Supabase, configurar esa dirección como URL del sitio y como URL permitida para los enlaces de acceso/invitación.
6. Invitar desde Supabase Authentication a las personas que podrán usarlo.
7. Ejecutar `password_setup_notifications.sql` en SQL Editor para habilitar la creación/recuperación de contraseñas y los avisos al administrador.

## Acceso y seguridad

- El código del sitio y `config.js` quedan visibles públicamente en GitHub Pages. La clave `sb_publishable` es una clave pública diseñada para el navegador.
- Los pedidos y adjuntos permanecen en Supabase. Las políticas RLS del esquema `schema.sql` limitan su uso a cuentas autenticadas.
- Invitar solo a las cuentas del equipo y desactivar el registro abierto antes de compartir la URL.
- Cada persona define su propia contraseña desde el enlace de invitación o desde «Crear o recuperar mi contraseña»; el administrador ve en el tablero cuando la configura por primera vez.
- El aviso aparece dentro del tablero si el administrador está conectado y queda guardado para la próxima visita. Para recibirlo por correo incluso sin tener el tablero abierto, hace falta conectar un servicio de correo saliente.
- No agregar claves `service_role`, contraseñas de base de datos ni tokens al repositorio.

## Archivos

- `index.html`, `app.js`: interfaz y comportamiento del tablero.
- `config.js`: URL del proyecto y clave publicable de Supabase.
- `schema.sql`: configuración de tablas, permisos, adjuntos privados y actualizaciones en vivo.
- `config.example.js`: plantilla de configuración.

## Respaldos

El botón **Respaldar datos** descarga pedidos e historial de avances en JSON. Los adjuntos privados no se incluyen en ese archivo y deben respaldarse aparte. GitHub conserva el historial del código; no respalda los datos guardados en Supabase.

El botón **Importar respaldo** acepta JSON con una propiedad `items`. Los archivos adjuntos almacenados en el tablero anterior deben cargarse nuevamente.
