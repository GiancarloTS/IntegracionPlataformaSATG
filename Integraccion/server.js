// =======================
// IMPORTACIONES Y CONFIG
// =======================
import express from "express";
import cors from "cors";
import vexor from "vexor";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import db from "./database.js";
import sqlite3 from "sqlite3";
import PDFDocument from "pdfkit";
import nodemailer from "nodemailer";
import fs from "fs";
import fetch from "node-fetch";
import { v4 as uuidv4 } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const port = 3000;
const { Vexor } = vexor;

const vexorInstance = new Vexor({
  publishableKey: process.env.VEXOR_PUBLISHABLE_KEY,
  projectId: process.env.VEXOR_PROJECT,
  apiKey: process.env.VEXOR_SECRET_KEY,
});

app.use(cors());
app.use(express.json());

// =======================
// FLUJO DE PAGO Y CARRITO
// =======================

// Endpoint para crear pago y guardar carrito pendiente
app.post("/create_payment", async (req, res) => {
  const { products, payer } = req.body;
  console.log("Datos recibidos en /create_payment:", products, payer);

  if (!products || !Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: "Faltan datos de los productos o el formato es incorrecto" });
  }
  if (!payer || !payer.email) {
    return res.status(400).json({ error: "El email del comprador es obligatorio" });
  }
  if (products.some((p) => !p.producto_id)) {
    return res.status(400).json({ error: "Todos los productos deben tener producto_id" });
  }

  const items = products.map((product) => ({
    title: product.title,
    unit_price: product.unit_price,
    quantity: product.quantity,
  }));

  try {
    const carritoId = uuidv4();

    // Buscar o crear cliente por email
    db.get('SELECT id FROM cliente WHERE email = ?', [payer.email], (err, row) => {
      if (err) return res.status(500).json({ error: "Error al buscar cliente" });

      function continuarConCliente(clienteId) {
        vexorInstance.pay.mercadopago({
          items,
          payer: {
            email: payer.email,
            name: payer.name || "",
            surname: payer.surname || "",
          },
        }).then(paymentResponse => {
          const prefId = paymentResponse.raw?.id;
          const identifier = paymentResponse.raw?.metadata?.identifier;

          const productosParaGuardar = products.map((product) => ({
            producto_id: product.producto_id,
            nombre_producto: product.title,
            cantidad: product.quantity,
            valor_producto: product.unit_price,
            subtotal: product.unit_price * product.quantity,
          }));

          db.run(
            `INSERT INTO carrito_pendiente (id, cliente_id, productos, total, fecha_creacion, pref_id, order_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              carritoId,
              clienteId,
              JSON.stringify(productosParaGuardar),
              productosParaGuardar.reduce((sum, p) => sum + p.subtotal, 0),
              new Date().toISOString(),
              prefId,
              identifier,
            ],
            (err) => {
              if (err) return res.status(500).json({ error: "Error al guardar el carrito" });
              res.status(200).json({ payment_url: paymentResponse.payment_url });
            }
          );
        }).catch(error => {
          res.status(500).json({ error: error.message || "Error al crear el pago" });
        });
      }

      if (row) {
        continuarConCliente(row.id);
      } else {
        db.run(
          'INSERT INTO cliente (nombre, email) VALUES (?, ?)',
          [payer.name || 'Sin Nombre', payer.email],
          function (err) {
            if (err) return res.status(500).json({ error: "Error al crear cliente" });
            continuarConCliente(this.lastID);
          }
        );
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Error al crear el pago" });
  }
});

// =======================
// WEBHOOK DE MERCADOPAGO
// =======================
app.post("/webhook/mercadopago", async (req, res) => {
  const event = req.body;

  if (event.type === "payment" && event.data && event.data.id) {
    const paymentId = event.data.id;

    try {
      const mpResponse = await fetch(
        `https://api.mercadopago.com/v1/payments/${paymentId}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
          },
        }
      );
      const paymentData = await mpResponse.json();
      const identifier = paymentData.metadata?.identifier;

      db.get(
        `SELECT * FROM carrito_pendiente WHERE order_id = ?`,
        [identifier],
        (err, carrito) => {
          if (err || !carrito) {
            return res.status(200).json({ message: "Carrito no encontrado, ignorado" });
          }

          const productos = JSON.parse(carrito.productos);
          const cliente_id = carrito.cliente_id;
          const total = carrito.total;
          const fecha = new Date().toISOString().slice(0, 19).replace("T", " ");

          db.run(
            `INSERT INTO pedidos (cliente_id, fecha, total) VALUES (?, ?, ?)`,
            [cliente_id, fecha, total],
            function (err) {
              if (err) return res.status(500).json({ error: "Error al registrar el pedido" });
              const pedido_id = this.lastID;
              const stmt = db.prepare(
                `INSERT INTO detalle_pedido (pedido_id, producto_id, nombre_producto, cantidad, valor_producto, subtotal)
                                     VALUES (?, ?, ?, ?, ?, ?)`
              );
              productos.forEach((prod) => {
                stmt.run([
                  pedido_id,
                  prod.producto_id,
                  prod.nombre_producto,
                  prod.cantidad,
                  prod.valor_producto,
                  prod.subtotal,
                ]);
              });
              stmt.finalize();

              db.run(`DELETE FROM carrito_pendiente WHERE order_id = ?`, [identifier]);
              res.status(200).json({
                message: "Pedido registrado correctamente",
                pedido_id,
              });
            }
          );
        }
      );
    } catch (error) {
      res.status(500).json({ error: "Error al consultar el pago en MercadoPago" });
    }
  } else {
    res.status(200).json({ message: "Evento ignorado" });
  }
});

// =======================
// PRODUCTOS Y INVENTARIO
// =======================

// Obtener producto por id
app.get("/productos/:id", (req, res) => {
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
    if (err) return res.status(500).json({ error: "Error al obtener producto" });
    if (!row) return res.status(404).json({ error: "Producto no encontrado" });
    res.status(200).json(row);
  });
});

// Obtener todos los productos
app.get("/productos", (req, res) => {
  const query = `
        SELECT p.id, p.nombre, p.descripcion, p.precio, 
               IFNULL(SUM(i.cantidad), 0) AS stock
        FROM productos p
        LEFT JOIN inventario i ON p.id = i.producto_id
        GROUP BY p.id
    `;
  db.all(query, (err, rows) => {
    if (err) return res.status(500).json({ error: "Error al obtener productos" });
    res.status(200).json(rows);
  });
});

// =======================
// CONSULTA GENERAL DE BASE DE DATOS
// =======================
const sqliteDb = new sqlite3.Database("./database.db", (err) => {
  if (err) {
    console.error("Error al conectar con la base de datos:", err.message);
  } else {
    console.log("Conectado a la base de datos SQLite");
  }
});

app.get("/api/database", (req, res) => {
  sqliteDb.all(
    "SELECT name FROM sqlite_master WHERE type='table'",
    [],
    (err, tables) => {
      if (err) return res.status(500).json({ error: "Error al obtener las tablas de la base de datos" });

      const database = {};
      let pending = tables.length;
      if (pending === 0) return res.json(database);

      tables.forEach((table) => {
        sqliteDb.all(`SELECT * FROM ${table.name}`, [], (err, rows) => {
          if (err) return res.status(500).json({ error: `Error al obtener registros de la tabla ${table.name}` });
          database[table.name] = rows;
          pending -= 1;
          if (pending === 0) res.json(database);
        });
      });
    }
  );
});

// =======================
// REPORTES Y CORREO
// =======================

if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
  console.error("Error: Variables de entorno EMAIL_USER o EMAIL_PASSWORD no están configuradas");
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

// Generar y enviar reporte PDF por correo
app.post("/api/enviar-reporte", async (req, res) => {
  const { email, tipo } = req.body;
  if (!email || !tipo) {
    return res.status(400).json({ error: "Debe proporcionar un correo y el tipo de reporte" });
  }

  const doc = new PDFDocument();
  const filename = `reporte_${tipo}_${Date.now()}.pdf`;
  const tempDir = "./temp";
  const filePath = `${tempDir}/${filename}`;

  try {
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);
    doc.fontSize(18).text(`Reporte: ${tipo}`, { align: "center" });
    doc.moveDown();

    if (tipo === "productos_vendidos") {
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
        doc.text(
          `Producto: ${row.nombre} - Total Vendido: ${row.total_vendido}`
        );
      });
    } else if (tipo === "mas_vendidos") {
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
        doc.text(
          `Producto: ${row.nombre} - Total Vendido: ${row.total_vendido}`
        );
      });
    } else if (tipo === "categorias_mas_vendidas") {
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
        doc.text(
          `Categoría: ${row.categoria} - Total Vendido: ${row.total_vendido}`
        );
      });
    } else {
      doc.text("Tipo de reporte no válido.");
    }

    doc.end();

    await new Promise((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: `Reporte: ${tipo}`,
      text: `Adjunto encontrará el reporte solicitado: ${tipo}.`,
      attachments: [{ filename, path: filePath }],
    };

    await transporter.sendMail(mailOptions);
    fs.unlinkSync(filePath);

    res.status(200).json({ message: "Correo enviado exitosamente" });
  } catch (error) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(500).json({ error: "Error al enviar el correo" });
  }
});

// =======================
// PEDIDOS Y DETALLES
// =======================

// Obtener pedidos con nombre de cliente
app.get("/api/pedidos", (req, res) => {
  const query = `
        SELECT pedidos.id, pedidos.fecha, pedidos.total, cliente.nombre AS cliente
        FROM pedidos
        LEFT JOIN cliente ON pedidos.cliente_id = cliente.id
        ORDER BY pedidos.fecha DESC
    `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: "Error al obtener pedidos" });
    res.json(rows);
  });
});

// Obtener detalles de un pedido (o todos)
app.get("/api/pedidos_con_detalles", (req, res) => {
  const pedidoId = req.query.id;
  let query = `
        SELECT 
            p.id AS pedido_id, p.fecha, p.total, c.nombre AS cliente,
            d.nombre_producto, d.cantidad, d.valor_producto, d.subtotal
        FROM pedidos p
        JOIN cliente c ON p.cliente_id = c.id
        LEFT JOIN detalle_pedido d ON d.pedido_id = p.id
  `;
  const params = [];
  if (pedidoId) {
    query += " WHERE p.id = ? ";
    params.push(pedidoId);
  }
  query += "ORDER BY p.fecha DESC, p.id, d.id";
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: "Error al obtener pedidos con detalles" });

    const pedidos = {};
    rows.forEach((row) => {
      if (!pedidos[row.pedido_id]) {
        pedidos[row.pedido_id] = {
          id: row.pedido_id,
          fecha: row.fecha,
          total: row.total,
          cliente: row.cliente,
          productos: [],
        };
      }
      if (row.nombre_producto) {
        pedidos[row.pedido_id].productos.push({
          nombre_producto: row.nombre_producto,
          cantidad: row.cantidad,
          valor_producto: row.valor_producto,
          subtotal: row.subtotal,
        });
      }
    });

    if (pedidoId) {
      if (pedidos[Number(pedidoId)]) {
        res.json(pedidos[Number(pedidoId)]);
      } else {
        db.get(
          `SELECT p.id AS pedido_id, p.fecha, p.total, c.nombre AS cliente
           FROM pedidos p
           JOIN cliente c ON p.cliente_id = c.id
           WHERE p.id = ?`,
          [pedidoId],
          (err, row) => {
            if (row) {
              res.json({
                id: row.pedido_id,
                fecha: row.fecha,
                total: row.total,
                cliente: row.cliente,
                productos: [],
              });
            } else {
              res.json({ productos: [] });
            }
          }
        );
      }
    } else {
      res.json(Object.values(pedidos));
    }
  });
});

// =======================
// SERVIR ARCHIVOS ESTÁTICOS Y LEVANTAR SERVIDOR
// =======================
app.use(express.static("public"));

app.listen(port, () => {
  console.log(`Servidor en http://localhost:${port}`);
});
