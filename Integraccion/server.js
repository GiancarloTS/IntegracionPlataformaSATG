import express from 'express'; // Importar el módulo express
import cors from 'cors'; // Importar el módulo cors para manejar CORS
import vexor from 'vexor'; // Importar el módulo vexor para manejar errores
import dotenv from 'dotenv'; // Importar el módulo dotenv para manejar variables de entorno
import { fileURLToPath } from 'url';
import path from 'path';
import db from './database.js'; // Importar la base de datos
import sqlite3 from 'sqlite3'; // Importar el módulo sqlite3


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


dotenv.config(); // Cargar las variables de entorno desde el archivo .env

const app = express();
const port = 3000;
const { Vexor } = vexor; // Inicializar vexor para manejar errores

const vexorInstance = new Vexor({
    publishableKey:'vx_prod_pk_769151bb2eb2ce214cdea3cca029865d_d131cd14_e9d4_4190_bdf1_9fd72ea67da2_7b62d4',
    projectId:'680dd8ff54ab54c284980947',
    apiKey:'vx_prod_sk_6508f65ae151ebc5e8037154a87c21d7_bc0d9532_63ac_4cd4_a52c_a156fe34160a_fce224'
});

app.use(cors()); // Habilitar CORS para todas las rutas
app.use(express.json()); // Middleware para parsear el cuerpo de las solicitudes como JSON

app.post('/create_payment', async (req, res) => {
    const { products } = req.body;
    console.log('Datos recibidos en /create_payment:', products); // Log para depuración

    if (!products || !Array.isArray(products) || products.length === 0) {
        console.error('Error: Faltan datos de los productos o el formato es incorrecto');
        return res.status(400).json({ error: 'Faltan datos de los productos o el formato es incorrecto' });
    }

    const items = products.map(product => {
        if (!product.title || !product.unit_price || !product.quantity) {
            console.error('Error: Faltan datos en uno o más productos:', product);
            throw new Error('Faltan datos en uno o más productos');
        }
        return {
            title: product.title,
            unit_price: product.unit_price,
            quantity: product.quantity,
        };
    });

    try {
        console.log('Datos enviados a vexor.pay.mercadopago:', items); // Log para depuración
        const paymentResponse = await vexorInstance.pay.mercadopago({
            items,
        });

        console.log('Respuesta de vexor.pay.mercadopago:', paymentResponse); // Log para depuración
        res.status(200).json({ payment_url: paymentResponse.payment_url });
    } catch (error) {
        console.error('Error al crear el pago:', error); // Log detallado del error
        res.status(500).json({ error: error.message || 'Error al crear el pago' });
    }
});




console.log('VEXOR_PROJECT:', process.env.VEXOR_PROJECT);
console.log('VEXOR_PUBLISHABLE_KEY:', process.env.VEXOR_PUBLISHABLE_KEY);
console.log('VEXOR_SECRET_KEY:', process.env.VEXOR_SECRET_KEY);

// apartado base de datos toy chato //

app.get('/productos/:id', (req, res) => {
    const { id } = req.params;
    const query = `
        SELECT p.id, p.nombre, p.descripcion, p.precio, 
               IFNULL(SUM(i.cantidad), 0) AS stock
        FROM productos p
        LEFT JOIN inventario i ON p.id = i.producto_id
        WHERE p.id = ?
        GROUP BY p.id
    `;

    db.get(query, [id], (err, row) => {
        if (err) {
            console.error('Error al obtener producto:', err.message);
            res.status(500).json({ error: 'Error al obtener producto' });
        } else if (!row) {
            res.status(404).json({ error: 'Producto no encontrado' });
        } else {
            res.status(200).json(row);
        }
    });
});

app.get('/productos', (req, res) => {
    const query = `
        SELECT p.id, p.nombre, p.descripcion, p.precio, 
               IFNULL(SUM(i.cantidad), 0) AS stock
        FROM productos p
        LEFT JOIN inventario i ON p.id = i.producto_id
        GROUP BY p.id
    `;

    db.all(query, (err, rows) => {
        if (err) {
            console.error('Error al obtener productos:', err.message);
            res.status(500).json({ error: 'Error al obtener productos' });
        } else {
            res.status(200).json(rows);
        }
    });
});

// Conexión a la base de datos SQLite
const sqliteDb = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('Error al conectar con la base de datos:', err.message);
    } else {
        console.log('Conectado a la base de datos SQLite');
    }
});

// Endpoint para obtener todas las tablas y registros
app.get('/api/database', (req, res) => {
    sqliteDb.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
        if (err) {
            console.error('Error al obtener las tablas:', err.message);
            return res.status(500).json({ error: 'Error al obtener las tablas de la base de datos' });
        }

        const database = {};
        let pending = tables.length;

        if (pending === 0) {
            return res.json(database);
        }

        tables.forEach(table => {
            sqliteDb.all(`SELECT * FROM ${table.name}`, [], (err, rows) => {
                if (err) {
                    console.error(`Error al obtener registros de la tabla ${table.name}:`, err.message);
                    return res.status(500).json({ error: `Error al obtener registros de la tabla ${table.name}` });
                }

                database[table.name] = rows;
                pending -= 1;

                if (pending === 0) {
                    res.json(database);
                }
            });
        });
    });
});

////////////////////////////////////////////

// Servir archivos estáticos desde la carpeta "public"
app.use(express.static('public'));


app.listen(port, () => {
    console.log(`Servidor en http://localhost:${port}`);
});