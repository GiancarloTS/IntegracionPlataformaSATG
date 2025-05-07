/**
 * Import required modules and initialize the Express application.
 * 
 * Modules:
 * - express: Web framework for Node.js.
 * - cors: Middleware to enable Cross-Origin Resource Sharing (CORS).
 * - vexor: Library for error handling and payment processing.
 * - dotenv: Loads environment variables from a .env file.
 * - url and path: Utilities for handling file paths.
 * - sqlite3: SQLite database driver.
 * - pdfkit: Library for generating PDF documents.
 * - nodemailer: Module to send emails.
 * 
 * Constants:
 * - __filename: The current file's absolute path.
 * - __dirname: The directory name of the current module.
 * 
 * Environment Variables:
 * - Loaded using dotenv to configure the application.
 * 
 * Vexor Configuration:
 * - Initialized with publishableKey, projectId, and apiKey for payment processing.
 */

/**
 * POST /create_payment
 * Endpoint to create a payment using Vexor's MercadoPago integration.
 * 
 * Request Body:
 * - products: Array of product objects, each containing:
 *   - title: Name of the product.
 *   - unit_price: Price per unit of the product.
 *   - quantity: Quantity of the product.
 * 
 * Response:
 * - 200: Returns a JSON object with the payment URL.
 * - 400: Returns an error if the products array is missing or invalid.
 * - 500: Returns an error if payment creation fails.
 */

/**
 * GET /productos/:id
 * Endpoint to retrieve a product by its ID, including its stock information.
 * 
 * Path Parameters:
 * - id: The ID of the product to retrieve.
 * 
 * Response:
 * - 200: Returns the product details and stock.
 * - 404: Returns an error if the product is not found.
 * - 500: Returns an error if there is a database issue.
 */

/**
 * GET /productos
 * Endpoint to retrieve all products, including their stock information.
 * 
 * Response:
 * - 200: Returns an array of products with their details and stock.
 * - 500: Returns an error if there is a database issue.
 */

/**
 * GET /api/database
 * Endpoint to retrieve all tables and their records from the SQLite database.
 * 
 * Response:
 * - 200: Returns an object containing all tables and their records.
 * - 500: Returns an error if there is a database issue.
 */

/**
 * GET /api/reportes
 * Endpoint to generate reports in PDF format.
 * 
 * Query Parameters:
 * - tipo: The type of report to generate. Supported values:
 *   - productos_vendidos: Report of sold products.
 *   - mas_vendidos: Report of the top 5 most sold products.
 *   - categorias_mas_vendidas: Report of the most sold categories.
 * 
 * Response:
 * - 200: Returns the generated PDF report as a downloadable file.
 * - 400: Returns an error if the report type is not specified.
 * - 500: Returns an error if there is an issue generating the report.
 */

/**
 * SQLite Database Connection
 * Establishes a connection to the SQLite database and logs the status.
 * 
 * Error Handling:
 * - Logs an error message if the connection fails.
 * - Logs a success message if the connection is established.
 */

/**
 * Static File Serving
 * Serves static files from the "public" directory.
 */

/**
 * Application Listener
 * Starts the Express server and listens on the specified port.
 * 
 * Logs:
 * - The URL where the server is running.
 */
import express from 'express'; // Importar el módulo express
import cors from 'cors'; // Importar el módulo cors para manejar CORS
import vexor from 'vexor'; // Importar el módulo vexor para manejar errores
import dotenv from 'dotenv'; // Importar el módulo dotenv para manejar variables de entorno
import { fileURLToPath } from 'url';
import path from 'path';
import db from './database.js'; // Importar la base de datos
import sqlite3 from 'sqlite3'; // Importar el módulo sqlite3
import PDFDocument from 'pdfkit'; // Importar el módulo pdfkit para generar PDFs
import nodemailer from 'nodemailer'; // Importar Nodemailer para enviar correos
import fs from 'fs'; // Importar el módulo fs para manejar archivos


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

// Endpoint para generar reportes en formato PDF
app.get('/api/reportes', async (req, res) => {
    const { tipo } = req.query;

    if (!tipo) {
        return res.status(400).json({ error: 'Debe especificar el tipo de reporte' });
    }

    const doc = new PDFDocument();
    const filename = `reporte_${tipo}_${Date.now()}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.setHeader('Content-Type', 'application/pdf');

    doc.pipe(res);

    try {
        doc.fontSize(18).text(`Reporte: ${tipo}`, { align: 'center' });
        doc.moveDown();

        if (tipo === 'productos_vendidos') {
            const query = `
                SELECT p.nombre, SUM(i.cantidad) AS total_vendido
                FROM inventario i
                JOIN productos p ON i.producto_id = p.id
                GROUP BY p.id
                ORDER BY total_vendido DESC
            `;
            db.all(query, [], (err, rows) => {
                if (err) {
                    console.error('Error al generar reporte de productos vendidos:', err.message);
                    doc.text('Error al generar reporte de productos vendidos.');
                    doc.end();
                    return;
                }
                rows.forEach((row) => {
                    doc.text(`Producto: ${row.nombre} - Total Vendido: ${row.total_vendido}`);
                });
                doc.end();
            });
        } else if (tipo === 'mas_vendidos') {
            const query = `
                SELECT p.nombre, SUM(i.cantidad) AS total_vendido
                FROM inventario i
                JOIN productos p ON i.producto_id = p.id
                GROUP BY p.id
                ORDER BY total_vendido DESC
                LIMIT 5
            `;
            db.all(query, [], (err, rows) => {
                if (err) {
                    console.error('Error al generar reporte de productos más vendidos:', err.message);
                    doc.text('Error al generar reporte de productos más vendidos.');
                    doc.end();
                    return;
                }
                rows.forEach((row) => {
                    doc.text(`Producto: ${row.nombre} - Total Vendido: ${row.total_vendido}`);
                });
                doc.end();
            });
        } else if (tipo === 'categorias_mas_vendidas') {
            const query = `
                SELECT c.nombre AS categoria, SUM(i.cantidad) AS total_vendido
                FROM inventario i
                JOIN productos p ON i.producto_id = p.id
                JOIN categorias c ON p.categoria_id = c.id
                GROUP BY c.id
                ORDER BY total_vendido DESC
            `;
            db.all(query, [], (err, rows) => {
                if (err) {
                    console.error('Error al generar reporte de categorías más vendidas:', err.message);
                    doc.text('Error al generar reporte de categorías más vendidas.');
                    doc.end();
                    return;
                }
                rows.forEach((row) => {
                    doc.text(`Categoría: ${row.categoria} - Total Vendido: ${row.total_vendido}`);
                });
                doc.end();
            });
        } else {
            doc.text('Tipo de reporte no válido.');
            doc.end();
        }
    } catch (error) {
        console.error('Error al generar el reporte:', error.message);
        doc.text('Error al generar el reporte.');
        doc.end();
    }
});

// Configuración de Nodemailer
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
    console.error('Error: Variables de entorno EMAIL_USER o EMAIL_PASSWORD no están configuradas');
    process.exit(1); // Finalizar la aplicación si las credenciales no están configuradas
}

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'ferremasreportes@gmail.com',
        pass: 'fsmh yauw zupi wjyh'
    }
});

// Endpoint para enviar el PDF por correo
app.post('/api/enviar-reporte', async (req, res) => {
    const { email, tipo } = req.body;

    if (!email || !tipo) {
        console.error('Error: Falta el correo o el tipo de reporte en la solicitud');
        return res.status(400).json({ error: 'Debe proporcionar un correo y el tipo de reporte' });
    }

    const doc = new PDFDocument();
    const filename = `reporte_${tipo}_${Date.now()}.pdf`;
    const tempDir = './temp';
    const filePath = `${tempDir}/${filename}`;

    try {
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }

        const writeStream = fs.createWriteStream(filePath);
        doc.pipe(writeStream);
        doc.fontSize(18).text(`Reporte: ${tipo}`, { align: 'center' });
        doc.moveDown();

        if (tipo === 'productos_vendidos') {
            const query = `
                SELECT p.nombre, SUM(i.cantidad) AS total_vendido
                FROM inventario i
                JOIN productos p ON i.producto_id = p.id
                GROUP BY p.id
                ORDER BY total_vendido DESC
            `;
            const rows = await new Promise((resolve, reject) => {
                db.all(query, [], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
            rows.forEach((row) => {
                doc.text(`Producto: ${row.nombre} - Total Vendido: ${row.total_vendido}`);
            });
        } else if (tipo === 'mas_vendidos') {
            const query = `
                SELECT p.nombre, SUM(i.cantidad) AS total_vendido
                FROM inventario i
                JOIN productos p ON i.producto_id = p.id
                GROUP BY p.id
                ORDER BY total_vendido DESC
                LIMIT 5
            `;
            const rows = await new Promise((resolve, reject) => {
                db.all(query, [], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
            rows.forEach((row) => {
                doc.text(`Producto: ${row.nombre} - Total Vendido: ${row.total_vendido}`);
            });
        } else if (tipo === 'categorias_mas_vendidas') {
            const query = `
                SELECT c.nombre AS categoria, SUM(i.cantidad) AS total_vendido
                FROM inventario i
                JOIN productos p ON i.producto_id = p.id
                JOIN categorias c ON p.categoria_id = c.id
                GROUP BY c.id
                ORDER BY total_vendido DESC
            `;
            const rows = await new Promise((resolve, reject) => {
                db.all(query, [], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
            rows.forEach((row) => {
                doc.text(`Categoría: ${row.categoria} - Total Vendido: ${row.total_vendido}`);
            });
        } else {
            doc.text('Tipo de reporte no válido.');
        }

        doc.end();

        await new Promise((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
        });

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: `Reporte: ${tipo}`,
            text: `Adjunto encontrará el reporte solicitado: ${tipo}.`,
            attachments: [
                {
                    filename,
                    path: filePath
                }
            ]
        };

        await transporter.sendMail(mailOptions);
        fs.unlinkSync(filePath);

        console.log(`Correo enviado exitosamente a ${email} con el reporte ${tipo}`);
        res.status(200).json({ message: 'Correo enviado exitosamente' });
    } catch (error) {
        console.error('Error al procesar la solicitud en /api/enviar-reporte:', error.message);

        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        res.status(500).json({ error: 'Error al enviar el correo' });
    }
});

app.listen(port, () => {
    console.log(`Servidor en http://localhost:${port}`);
});