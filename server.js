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

const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_l98VUAbKiWgw@ep-misty-sea-a4x09y0o-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
});

const initDB = async () => {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY, usuario TEXT UNIQUE, correo TEXT UNIQUE, password TEXT, rol TEXT DEFAULT 'alumno')`);
        await pool.query(`CREATE TABLE IF NOT EXISTS categorias (id SERIAL PRIMARY KEY, nombre TEXT UNIQUE, color TEXT DEFAULT '#3b82f6')`);
        await pool.query(`CREATE TABLE IF NOT EXISTS cuestionarios (id SERIAL PRIMARY KEY, titulo TEXT, descripcion TEXT)`);
        try { await pool.query(`ALTER TABLE cuestionarios ADD COLUMN categoria_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL`); } catch(e) {}
        await pool.query(`CREATE TABLE IF NOT EXISTS preguntas (id SERIAL PRIMARY KEY, cuestionario_id INTEGER REFERENCES cuestionarios(id) ON DELETE CASCADE, texto_pregunta TEXT)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS opciones (id SERIAL PRIMARY KEY, pregunta_id INTEGER REFERENCES preguntas(id) ON DELETE CASCADE, texto_opcion TEXT, es_correcta INTEGER)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS asignaciones (usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE, cuestionario_id INTEGER REFERENCES cuestionarios(id) ON DELETE CASCADE)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS resultados (id SERIAL PRIMARY KEY, usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE, cuestionario_id INTEGER REFERENCES cuestionarios(id) ON DELETE CASCADE, aciertos INTEGER, total_preguntas INTEGER, fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS detalles_resultado (id SERIAL PRIMARY KEY, resultado_id INTEGER REFERENCES resultados(id) ON DELETE CASCADE, pregunta_id INTEGER REFERENCES preguntas(id) ON DELETE CASCADE, opcion_seleccionada_id INTEGER REFERENCES opciones(id) ON DELETE CASCADE)`);
        
        try { await pool.query(`ALTER TABLE resultados ADD COLUMN es_repaso BOOLEAN DEFAULT false`); } catch(e) {}
        try { await pool.query(`ALTER TABLE resultados ADD COLUMN es_simulacion BOOLEAN DEFAULT false`); } catch(e) {}
        try { await pool.query(`ALTER TABLE resultados ADD COLUMN categoria_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL`); } catch(e) {}
        try { await pool.query(`ALTER TABLE usuarios ADD COLUMN repaso_bloque TEXT`); } catch(e) {}
        try { await pool.query(`ALTER TABLE usuarios ADD COLUMN repaso_intentos INTEGER DEFAULT 0`); } catch(e) {}
        
        console.log("¡Conectado exitosamente a la base de datos (Motor de Simulación por Categoría y Paginación Activado)!");
    } catch (err) { console.error("Error al crear tablas:", err); }
};
initDB();

app.post('/registro', async (req, res) => {
    const { usuario, correo, password } = req.body;
    if (!usuario || !correo || !password) return res.status(400).json({ error: "Faltan campos." });
    const rolUsuario = (usuario.toLowerCase() === 'admin') ? 'admin' : 'alumno';
    try {
        const passwordEncriptada = await bcrypt.hash(password, 10);
        await pool.query(`INSERT INTO usuarios (usuario, correo, password, rol) VALUES ($1, $2, $3, $4)`, [usuario, correo, passwordEncriptada, rolUsuario]);
        res.json({ mensaje: "¡Cuenta creada!" });
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

app.post('/crear-categoria', async (req, res) => {
    const { nombre, color } = req.body;
    try { await pool.query(`INSERT INTO categorias (nombre, color) VALUES ($1, $2)`, [nombre, color]); res.json({ mensaje: "Categoría creada" }); } 
    catch(e) { res.status(400).json({ error: "Categoría existente o error." }); }
});

app.get('/categorias', async (req, res) => {
    try { const result = await pool.query(`SELECT * FROM categorias ORDER BY nombre ASC`); res.json(result.rows); } catch(e) { res.status(500).json({ error: "Error" }); }
});

app.post('/crear-cuestionario', async (req, res) => {
    const { titulo, categoria_id } = req.body; const catId = categoria_id ? parseInt(categoria_id) : null;
    try { const result = await pool.query(`INSERT INTO cuestionarios (titulo, categoria_id) VALUES ($1, $2) RETURNING id`, [titulo, catId]); res.json({ mensaje: `Guardado!`, id: result.rows[0].id }); } 
    catch(err) { res.status(500).json({ error: "Error." }); }
});

app.get('/cuestionarios', async (req, res) => { 
    const result = await pool.query(`SELECT c.*, cat.nombre as categoria_nombre FROM cuestionarios c LEFT JOIN categorias cat ON c.categoria_id = cat.id ORDER BY c.id DESC`); res.json(result.rows); 
});

app.put('/editar-cuestionario/:id', async (req, res) => {
    const { titulo, categoria_id } = req.body; const catId = categoria_id ? parseInt(categoria_id) : null;
    try { await pool.query(`UPDATE cuestionarios SET titulo = $1, categoria_id = $2 WHERE id = $3`, [titulo, catId, req.params.id]); res.json({ mensaje: "Actualizado" }); } 
    catch(err) { res.status(500).json({ error: "Error." }); }
});

app.post('/agregar-pregunta', async (req, res) => {
    const { cuestionario_id, texto_pregunta, opciones } = req.body;
    try {
        const resultPreg = await pool.query(`INSERT INTO preguntas (cuestionario_id, texto_pregunta) VALUES ($1, $2) RETURNING id`, [cuestionario_id, texto_pregunta]);
        const pregunta_id = resultPreg.rows[0].id; 
        for(let op of opciones) { await pool.query(`INSERT INTO opciones (pregunta_id, texto_opcion, es_correcta) VALUES ($1, $2, $3)`, [pregunta_id, op.texto, op.es_correcta]); }
        res.json({ mensaje: "¡Agregada!" });
    } catch(err) { res.status(500).json({ error: "Error." }); }
});

app.get('/alumnos', async (req, res) => { 
    const result = await pool.query(`SELECT id, usuario FROM usuarios WHERE rol = 'alumno'`); res.json(result.rows); 
});

app.post('/asignar', async (req, res) => {
    const { usuario_id, cuestionario_id } = req.body;
    try {
        const check = await pool.query(`SELECT * FROM asignaciones WHERE usuario_id = $1 AND cuestionario_id = $2`, [usuario_id, cuestionario_id]);
        if (check.rows.length > 0) return res.status(400).json({ error: "El alumno ya tiene este simulador." });
        await pool.query(`INSERT INTO asignaciones (usuario_id, cuestionario_id) VALUES ($1, $2)`, [usuario_id, cuestionario_id]);
        res.json({ mensaje: "¡Acceso otorgado!" });
    } catch(err) { res.status(500).json({ error: "Error." }); }
});

app.get('/preguntas-admin/:cuestionario_id', async (req, res) => {
    const result = await pool.query(`SELECT id, texto_pregunta FROM preguntas WHERE cuestionario_id = $1`, [req.params.cuestionario_id]); res.json(result.rows);
});

app.delete('/eliminar-pregunta/:id', async (req, res) => {
    try { await pool.query(`DELETE FROM opciones WHERE pregunta_id = $1`, [req.params.id]); await pool.query(`DELETE FROM preguntas WHERE id = $1`, [req.params.id]); res.json({ mensaje: "Eliminada" }); } 
    catch(err) { res.status(500).json({ error: "Error." }); }
});

app.get('/reportes', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT r.id, u.usuario, 
                CASE WHEN r.es_simulacion THEN CONCAT('🎓 SIMULACIÓN FINAL (', COALESCE(cat_sim.nombre, 'General'), ')') WHEN r.es_repaso THEN '🚨 Simulador de Repaso' ELSE c.titulo END as titulo, 
                r.aciertos, r.total_preguntas, r.fecha
            FROM resultados r JOIN usuarios u ON r.usuario_id = u.id LEFT JOIN cuestionarios c ON r.cuestionario_id = c.id LEFT JOIN categorias cat_sim ON r.categoria_id = cat_sim.id
            ORDER BY r.fecha DESC
        `);
        res.json(result.rows);
    } catch(err) { res.status(500).json({ error: "Error." }); }
});

app.get('/mis-cuestionarios/:usuario_id', async (req, res) => {
    const result = await pool.query(`
        SELECT c.id, c.titulo, c.categoria_id, cat.nombre as categoria_nombre, cat.color as categoria_color
        FROM cuestionarios c JOIN asignaciones a ON c.id = a.cuestionario_id LEFT JOIN categorias cat ON c.categoria_id = cat.id
        WHERE a.usuario_id = $1
    `, [req.params.usuario_id]);
    res.json(result.rows);
});

app.get('/mi-historial/:usuario_id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT r.id, 
                   CASE WHEN r.es_simulacion THEN '🎓 SIMULACIÓN FINAL PROFESIONAL' WHEN r.es_repaso THEN '🚨 Simulador de Repaso' ELSE COALESCE(c.titulo, 'Examen') END as titulo, 
                   CASE WHEN r.es_repaso THEN 'Zona de Refuerzo' ELSE COALESCE(cat.nombre, COALESCE(cat_sim.nombre, 'Módulo General')) END as categoria_nombre, 
                   CASE WHEN r.es_repaso THEN '#ef4444' ELSE COALESCE(cat.color, COALESCE(cat_sim.color, '#64748b')) END as categoria_color, 
                   r.aciertos, r.total_preguntas, r.fecha, r.es_repaso, r.es_simulacion
            FROM resultados r LEFT JOIN cuestionarios c ON r.cuestionario_id = c.id LEFT JOIN categorias cat ON c.categoria_id = cat.id LEFT JOIN categorias cat_sim ON r.categoria_id = cat_sim.id
            WHERE r.usuario_id = $1 ORDER BY r.fecha DESC
        `, [req.params.usuario_id]);
        res.json(result.rows);
    } catch(err) { res.status(500).json({ error: "Error." }); }
});

app.get('/detalle-intento/:resultado_id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.texto_pregunta, (SELECT texto_opcion FROM opciones WHERE pregunta_id = p.id AND es_correcta = 1 LIMIT 1) as opcion_correcta, o_user.texto_opcion as opcion_elegida, o_user.es_correcta as es_correcta
            FROM detalles_resultado dr JOIN preguntas p ON dr.pregunta_id = p.id LEFT JOIN opciones o_user ON dr.opcion_seleccionada_id = o_user.id
            WHERE dr.resultado_id = $1 ORDER BY p.id ASC
        `, [req.params.resultado_id]);
        res.json(result.rows);
    } catch(err) { res.status(500).json({ error: "Error." }); }
});

app.get('/examen/:cuestionario_id', async (req, res) => {
    try {
        const resPreguntas = await pool.query(`SELECT * FROM preguntas WHERE cuestionario_id = $1`, [req.params.cuestionario_id]);
        const preguntas = resPreguntas.rows;
        if (preguntas.length === 0) return res.json([]);
        const preguntaIds = preguntas.map(p => p.id);
        const resOpciones = await pool.query(`SELECT * FROM opciones WHERE pregunta_id = ANY($1::int[])`, [preguntaIds]);
        const opciones = resOpciones.rows;
        const examenCompleto = preguntas.map(p => ({ id: p.id, texto: p.texto_pregunta, opciones: opciones.filter(o => o.pregunta_id === p.id).map(o => ({ id: o.id, texto: o.texto_opcion, es_correcta: o.es_correcta })) }));
        res.json(examenCompleto);
    } catch(err) { res.status(500).json({ error: "Error." }); }
});

app.get('/errores-alumno/:usuario_id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT DISTINCT p.id, p.texto_pregunta, COALESCE(c.titulo, 'Sin Módulo') as modulo_origen
            FROM detalles_resultado dr JOIN resultados r ON dr.resultado_id = r.id JOIN preguntas p ON dr.pregunta_id = p.id LEFT JOIN cuestionarios c ON p.cuestionario_id = c.id LEFT JOIN opciones o ON dr.opcion_seleccionada_id = o.id
            WHERE r.usuario_id = $1 AND (o.es_correcta = 0 OR o.id IS NULL)
            AND p.id NOT IN (
                SELECT dr2.pregunta_id FROM detalles_resultado dr2 JOIN resultados r2 ON dr2.resultado_id = r2.id JOIN opciones o2 ON dr2.opcion_seleccionada_id = o2.id 
                WHERE r2.usuario_id = $1 AND r2.es_repaso = true AND o2.es_correcta = 1
            )
        `, [req.params.usuario_id]);
        res.json(result.rows);
    } catch(e) { res.status(500).json({error: "Error"}); }
});

app.get('/examen-repaso/:usuario_id', async (req, res) => {
    try {
        const userId = req.params.usuario_id;
        const userRes = await pool.query(`SELECT repaso_bloque, repaso_intentos FROM usuarios WHERE id = $1`, [userId]);
        let bloque = userRes.rows[0].repaso_bloque ? JSON.parse(userRes.rows[0].repaso_bloque) : null;
        let intentos = userRes.rows[0].repaso_intentos || 0;
        let preguntaIds = [];

        if (bloque && bloque.length > 0 && intentos < 3) {
            preguntaIds = bloque; await pool.query(`UPDATE usuarios SET repaso_intentos = repaso_intentos + 1 WHERE id = $1`, [userId]); intentos++;
        } else {
            const resErrores = await pool.query(`
                SELECT DISTINCT p.id FROM detalles_resultado dr JOIN resultados r ON dr.resultado_id = r.id JOIN preguntas p ON dr.pregunta_id = p.id LEFT JOIN opciones o ON dr.opcion_seleccionada_id = o.id
                WHERE r.usuario_id = $1 AND (o.es_correcta = 0 OR o.id IS NULL) AND p.id NOT IN (
                    SELECT dr2.pregunta_id FROM detalles_resultado dr2 JOIN resultados r2 ON dr2.resultado_id = r2.id JOIN opciones o2 ON dr2.opcion_seleccionada_id = o2.id 
                    WHERE r2.usuario_id = $1 AND r2.es_repaso = true AND o2.es_correcta = 1
                )
            `, [userId]);
            let errores = resErrores.rows.map(r => r.id);
            if (errores.length === 0) return res.json({ preguntas: [], intentoActual: 0 });
            errores = errores.sort(() => 0.5 - Math.random()).slice(0, 15); preguntaIds = errores;
            await pool.query(`UPDATE usuarios SET repaso_bloque = $1, repaso_intentos = 1 WHERE id = $2`, [JSON.stringify(preguntaIds), userId]); intentos = 1;
        }

        const resPreguntas = await pool.query(`SELECT id, texto_pregunta FROM preguntas WHERE id = ANY($1::int[])`, [preguntaIds]);
        const resOpciones = await pool.query(`SELECT * FROM opciones WHERE pregunta_id = ANY($1::int[])`, [preguntaIds]);
        const examenCompleto = resPreguntas.rows.map(p => ({ id: p.id, texto: p.texto_pregunta, opciones: resOpciones.rows.filter(o => o.pregunta_id === p.id).map(o => ({ id: o.id, texto: o.texto_opcion, es_correcta: o.es_correcta })) }));
        res.json({ preguntas: examenCompleto, intentoActual: intentos });
    } catch(e) { res.status(500).json({error: "Error"}); }
});

// SIMULACIÓN DINÁMICA POR CATEGORÍA
app.get('/examen-simulacion-final/:categoria_id', async (req, res) => {
    try {
        const catId = req.params.categoria_id;
        let queryStr = `SELECT p.id, p.texto_pregunta FROM preguntas p JOIN cuestionarios c ON p.cuestionario_id = c.id WHERE c.categoria_id = $1`;
        let queryParams = [catId];
        
        if(catId === 'null') {
            queryStr = `SELECT p.id, p.texto_pregunta FROM preguntas p JOIN cuestionarios c ON p.cuestionario_id = c.id WHERE c.categoria_id IS NULL`;
            queryParams = [];
        }

        const resPreguntas = await pool.query(queryStr, queryParams);
        const preguntas = resPreguntas.rows;
        if (preguntas.length === 0) return res.json([]);
        
        const resOpciones = await pool.query(`SELECT id, pregunta_id, texto_opcion, es_correcta FROM opciones`);
        const opciones = resOpciones.rows;
        
        const examenCompleto = preguntas.map(p => ({
            id: p.id, texto: p.texto_pregunta,
            opciones: opciones.filter(o => o.pregunta_id === p.id).map(o => ({ id: o.id, texto: o.texto_opcion, es_correcta: o.es_correcta }))
        }));
        res.json(examenCompleto);
    } catch(e) { res.status(500).json({error: "Error al generar simulación"}); }
});

app.post('/guardar-resultado', async (req, res) => {
    const { usuario_id, cuestionario_id, aciertos, total, respuestas, es_repaso, es_simulacion, categoria_id } = req.body;
    try {
        const c_id = (es_repaso || es_simulacion) ? null : cuestionario_id;
        const cat_id = categoria_id ? parseInt(categoria_id) : null;
        const result = await pool.query(`INSERT INTO resultados (usuario_id, cuestionario_id, aciertos, total_preguntas, es_repaso, es_simulacion, categoria_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [usuario_id, c_id, aciertos, total, es_repaso ? true : false, es_simulacion ? true : false, cat_id]);
        const resultado_id = result.rows[0].id;
        for (const preguntaId in respuestas) {
            const opcionId = respuestas[preguntaId];
            await pool.query(`INSERT INTO detalles_resultado (resultado_id, pregunta_id, opcion_seleccionada_id) VALUES ($1, $2, $3)`, [resultado_id, parseInt(preguntaId), opcionId || null]);
        }
        res.json({mensaje: "¡Resultados guardados!"});
    } catch(err) { res.status(500).json({ error: "Error al guardar." }); }
});

app.listen(puerto, () => {
    console.log(`¡Servidor encendido! 🚀 Ábrelo en: http://localhost:${puerto}`);
});
