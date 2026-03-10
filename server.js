const express = require('express');
const { Pool } = require('pg'); 
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const puerto = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==========================================
// CONEXIÓN A TU BASE DE DATOS EN LA NUBE (NEON)
// ==========================================
const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_l98VUAbKiWgw@ep-misty-sea-a4x09y0o-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
});

const initDB = async () => {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY, usuario TEXT UNIQUE, correo TEXT UNIQUE, password TEXT, rol TEXT DEFAULT 'alumno')`);
        await pool.query(`CREATE TABLE IF NOT EXISTS cuestionarios (id SERIAL PRIMARY KEY, titulo TEXT, descripcion TEXT)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS preguntas (id SERIAL PRIMARY KEY, cuestionario_id INTEGER REFERENCES cuestionarios(id) ON DELETE CASCADE, texto_pregunta TEXT)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS opciones (id SERIAL PRIMARY KEY, pregunta_id INTEGER REFERENCES preguntas(id) ON DELETE CASCADE, texto_opcion TEXT, es_correcta INTEGER)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS asignaciones (usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE, cuestionario_id INTEGER REFERENCES cuestionarios(id) ON DELETE CASCADE)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS resultados (id SERIAL PRIMARY KEY, usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE, cuestionario_id INTEGER REFERENCES cuestionarios(id) ON DELETE CASCADE, aciertos INTEGER, total_preguntas INTEGER, fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        
        // NUEVA TABLA: Para guardar el desglose histórico de cada intento
        await pool.query(`CREATE TABLE IF NOT EXISTS detalles_resultado (id SERIAL PRIMARY KEY, resultado_id INTEGER REFERENCES resultados(id) ON DELETE CASCADE, pregunta_id INTEGER REFERENCES preguntas(id) ON DELETE CASCADE, opcion_seleccionada_id INTEGER REFERENCES opciones(id) ON DELETE CASCADE)`);
        
        console.log("¡Conectado exitosamente a la base de datos en NEON (AWS)!");
    } catch (err) {
        console.error("Error al crear tablas en Postgres:", err);
    }
};
initDB();

// ==========================================
// RUTAS DE SESIÓN
// ==========================================
app.post('/registro', async (req, res) => {
    const { usuario, correo, password } = req.body;
    if (!usuario || !correo || !password) return res.status(400).json({ error: "Faltan campos." });
    const rolUsuario = (usuario.toLowerCase() === 'admin') ? 'admin' : 'alumno';
    try {
        const passwordEncriptada = await bcrypt.hash(password, 10);
        await pool.query(`INSERT INTO usuarios (usuario, correo, password, rol) VALUES ($1, $2, $3, $4)`, [usuario, correo, passwordEncriptada, rolUsuario]);
        res.json({ mensaje: "¡Cuenta creada en la nube!" });
    } catch (error) { res.status(400).json({ error: "El usuario o correo ya existen." }); }
});

app.post('/login', async (req, res) => {
    const { usuario, password } = req.body;
    try {
        const result = await pool.query(`SELECT * FROM usuarios WHERE usuario = $1`, [usuario]);
        const fila = result.rows[0];
        if (!fila) return res.status(400).json({ error: "Usuario incorrecto." });
        const contrasenaValida = await bcrypt.compare(password, fila.password);
        if (contrasenaValida) res.json({ mensaje: "Bienvenido", rol: fila.rol, id: fila.id });
        else res.status(400).json({ error: "Contraseña incorrecta." });
    } catch(err) { res.status(500).json({ error: "Error en el servidor." }); }
});

app.post('/cambiar-password', async (req, res) => {
    const { usuario, nuevaPassword } = req.body;
    try {
        const result = await pool.query(`SELECT * FROM usuarios WHERE usuario = $1`, [usuario]);
        if (result.rows.length === 0) return res.status(400).json({ error: "Ese usuario no existe." });
        const nuevaPasswordEncriptada = await bcrypt.hash(nuevaPassword, 10);
        await pool.query(`UPDATE usuarios SET password = $1 WHERE usuario = $2`, [nuevaPasswordEncriptada, usuario]);
        res.json({ mensaje: "¡Contraseña actualizada!" });
    } catch(err) { res.status(500).json({ error: "Error interno." }); }
});

// ==========================================
// RUTAS DEL ADMINISTRADOR
// ==========================================
app.post('/crear-cuestionario', async (req, res) => {
    const { titulo } = req.body;
    try {
        const result = await pool.query(`INSERT INTO cuestionarios (titulo) VALUES ($1) RETURNING id`, [titulo]);
        res.json({ mensaje: `¡Cuestionario guardado!`, id: result.rows[0].id });
    } catch(err) { res.status(500).json({ error: "Error al guardar." }); }
});

app.get('/cuestionarios', async (req, res) => { 
    const result = await pool.query(`SELECT * FROM cuestionarios ORDER BY id DESC`); 
    res.json(result.rows); 
});

// NUEVA RUTA: Editar nombre del cuestionario
app.put('/editar-cuestionario/:id', async (req, res) => {
    const { titulo } = req.body;
    try {
        await pool.query(`UPDATE cuestionarios SET titulo = $1 WHERE id = $2`, [titulo, req.params.id]);
        res.json({ mensaje: "Título actualizado exitosamente" });
    } catch(err) { res.status(500).json({ error: "Error al actualizar." }); }
});

app.post('/agregar-pregunta', async (req, res) => {
    const { cuestionario_id, texto_pregunta, opciones } = req.body;
    try {
        const resultPreg = await pool.query(`INSERT INTO preguntas (cuestionario_id, texto_pregunta) VALUES ($1, $2) RETURNING id`, [cuestionario_id, texto_pregunta]);
        const pregunta_id = resultPreg.rows[0].id; 
        for(let op of opciones) { await pool.query(`INSERT INTO opciones (pregunta_id, texto_opcion, es_correcta) VALUES ($1, $2, $3)`, [pregunta_id, op.texto, op.es_correcta]); }
        res.json({ mensaje: "¡Pregunta agregada a la nube!" });
    } catch(err) { res.status(500).json({ error: "Error al guardar pregunta." }); }
});

app.get('/alumnos', async (req, res) => { 
    const result = await pool.query(`SELECT id, usuario FROM usuarios WHERE rol = 'alumno'`); 
    res.json(result.rows); 
});

app.post('/asignar', async (req, res) => {
    const { usuario_id, cuestionario_id } = req.body;
    try {
        const check = await pool.query(`SELECT * FROM asignaciones WHERE usuario_id = $1 AND cuestionario_id = $2`, [usuario_id, cuestionario_id]);
        if (check.rows.length > 0) return res.status(400).json({ error: "El alumno ya tiene este simulador." });
        await pool.query(`INSERT INTO asignaciones (usuario_id, cuestionario_id) VALUES ($1, $2)`, [usuario_id, cuestionario_id]);
        res.json({ mensaje: "¡Acceso otorgado en la nube!" });
    } catch(err) { res.status(500).json({ error: "Error al asignar." }); }
});

app.get('/preguntas-admin/:cuestionario_id', async (req, res) => {
    const { cuestionario_id } = req.params;
    const result = await pool.query(`SELECT id, texto_pregunta FROM preguntas WHERE cuestionario_id = $1`, [cuestionario_id]);
    res.json(result.rows);
});

app.delete('/eliminar-pregunta/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query(`DELETE FROM opciones WHERE pregunta_id = $1`, [id]);
        await pool.query(`DELETE FROM preguntas WHERE id = $1`, [id]);
        res.json({ mensaje: "¡Pregunta eliminada!" });
    } catch(err) { res.status(500).json({ error: "Error al borrar." }); }
});

app.get('/reportes', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT r.id, u.usuario, c.titulo, r.aciertos, r.total_preguntas, r.fecha
            FROM resultados r
            JOIN usuarios u ON r.usuario_id = u.id
            JOIN cuestionarios c ON r.cuestionario_id = c.id
            ORDER BY r.fecha DESC
        `);
        res.json(result.rows);
    } catch(err) { res.status(500).json({ error: "Error al cargar reportes." }); }
});

// ==========================================
// RUTAS DEL ALUMNO (MOTOR DE EXÁMENES E HISTORIAL)
// ==========================================
app.get('/mis-cuestionarios/:usuario_id', async (req, res) => {
    const { usuario_id } = req.params;
    const result = await pool.query(`SELECT c.id, c.titulo FROM cuestionarios c JOIN asignaciones a ON c.id = a.cuestionario_id WHERE a.usuario_id = $1`, [usuario_id]);
    res.json(result.rows);
});

// NUEVA RUTA: Ver historial general del alumno
app.get('/mi-historial/:usuario_id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT r.id, c.titulo, r.aciertos, r.total_preguntas, r.fecha
            FROM resultados r
            JOIN cuestionarios c ON r.cuestionario_id = c.id
            WHERE r.usuario_id = $1
            ORDER BY r.fecha DESC
        `, [req.params.usuario_id]);
        res.json(result.rows);
    } catch(err) { res.status(500).json({ error: "Error al cargar historial." }); }
});

// NUEVA RUTA: Ver el desglose detallado de un intento específico
app.get('/detalle-intento/:resultado_id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                p.texto_pregunta,
                (SELECT texto_opcion FROM opciones WHERE pregunta_id = p.id AND es_correcta = 1 LIMIT 1) as opcion_correcta,
                o_user.texto_opcion as opcion_elegida,
                o_user.es_correcta as es_correcta
            FROM detalles_resultado dr
            JOIN preguntas p ON dr.pregunta_id = p.id
            LEFT JOIN opciones o_user ON dr.opcion_seleccionada_id = o_user.id
            WHERE dr.resultado_id = $1
            ORDER BY p.id ASC
        `, [req.params.resultado_id]);
        res.json(result.rows);
    } catch(err) { res.status(500).json({ error: "Error al cargar detalle." }); }
});

app.get('/examen/:cuestionario_id', async (req, res) => {
    const { cuestionario_id } = req.params;
    try {
        const resPreguntas = await pool.query(`SELECT * FROM preguntas WHERE cuestionario_id = $1`, [cuestionario_id]);
        const preguntas = resPreguntas.rows;
        if (preguntas.length === 0) return res.json([]);
        
        const preguntaIds = preguntas.map(p => p.id);
        const resOpciones = await pool.query(`SELECT * FROM opciones WHERE pregunta_id = ANY($1::int[])`, [preguntaIds]);
        const opciones = resOpciones.rows;

        const examenCompleto = preguntas.map(p => {
            return {
                id: p.id, texto: p.texto_pregunta,
                opciones: opciones.filter(o => o.pregunta_id === p.id).map(o => ({ id: o.id, texto: o.texto_opcion, es_correcta: o.es_correcta }))
            };
        });
        res.json(examenCompleto);
    } catch(err) { res.status(500).json({ error: "Error al descargar examen." }); }
});

// ACTUALIZADA: Ahora guarda el resultado general Y las respuestas individuales
app.post('/guardar-resultado', async (req, res) => {
    const { usuario_id, cuestionario_id, aciertos, total, respuestas } = req.body;
    try {
        // Guardamos el intento general y pedimos que nos devuelva el ID
        const result = await pool.query(`INSERT INTO resultados (usuario_id, cuestionario_id, aciertos, total_preguntas) VALUES ($1, $2, $3, $4) RETURNING id`, [usuario_id, cuestionario_id, aciertos, total]);
        const resultado_id = result.rows[0].id;

        // Guardamos cada respuesta individual vinculada a ese ID
        for (const preguntaId in respuestas) {
            const opcionId = respuestas[preguntaId];
            await pool.query(`INSERT INTO detalles_resultado (resultado_id, pregunta_id, opcion_seleccionada_id) VALUES ($1, $2, $3)`, [resultado_id, parseInt(preguntaId), opcionId || null]);
        }
        res.json({mensaje: "¡Resultados guardados en la nube!"});
    } catch(err) { res.status(500).json({ error: "Error al guardar." }); }
});

app.listen(puerto, () => {
    console.log(`¡Servidor encendido! 🚀 Ábrelo en: http://localhost:${puerto}`);
});
