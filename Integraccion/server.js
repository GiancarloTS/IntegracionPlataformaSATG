import express from "express"; // Importar el módulo express
import cors from "cors"; // Importar el módulo cors para manejar CORS
import vexor from "vexor"; // Importar el módulo vexor para manejar errores
import dotenv from "dotenv"; // Importar el módulo dotenv para manejar variables de entorno
import { fileURLToPath } from "url";
import path from "path";
import db from "./database.js"; // Importar la base de datos
import sqlite3 from "sqlite3"; // Importar el módulo sqlite3
import PDFDocument from "pdfkit"; // Importar el módulo pdfkit para generar PDFs
import nodemailer from "nodemailer"; // Importar Nodemailer para enviar correos
import fs from "fs"; // Importar el módulo fs para manejar archivos
import fetch from "node-fetch"; // Si no tienes, instala con: npm install node-fetch
import { v4 as uuidv4 } from "uuid"; // npm install uuid

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config(); // Cargar las variables de entorno desde el archivo .env

const app = express();
const port = 3000;
const { Vexor } = vexor; // Inicializar vexor para manejar errores

const vexorInstance = new Vexor({
  publishableKey:
    "vx_prod_pk_769151bb2eb2ce214cdea3cca029865d_d131cd14_e9d4_4190_bdf1_9fd72ea67da2_7b62d4",
  projectId: "680dd8ff54ab54c284980947",
  apiKey:
    "vx_prod_sk_6508f65ae151ebc5e8037154a87c21d7_bc0d9532_63ac_4cd4_a52c_a156fe34160a_fce224",
});

app.use(cors()); // Habilitar CORS para todas las rutas
app.use(express.json()); // Middleware para parsear el cuerpo de las solicitudes como JSON

// --- FLUJO DE PAGO Y CARRITO PENDIENTE ---

// Endpoint para crear pago y guardar carrito pendiente
app.post("/create_payment", async (req, res) => {
  const { products, payer } = req.body;
  console.log("Datos recibidos en /create_payment:", products, payer);

  if (!products || !Array.isArray(products) || products.length === 0) {
    console.error(
      "Error: Faltan datos de los productos o el formato es incorrecto"
    );
    return res.status(400).json({
      error: "Faltan datos de los productos o el formato es incorrecto",
    });
  }

  if (!payer || !payer.email) {
    console.error("Error: El email del comprador es obligatorio");
    return res
      .status(400)
      .json({ error: "El email del comprador es obligatorio" });
  }

  // Validar que cada producto tenga producto_id
  if (products.some((p) => !p.producto_id)) {
    console.error("Error: Algún producto no tiene producto_id:", products);
    return res
      .status(400)
      .json({ error: "Todos los productos deben tener producto_id" });
  }

  const items = products.map((product) => ({
    title: product.title,
    unit_price: product.unit_price,
    quantity: product.quantity,
  }));

  try {
    const carritoId = uuidv4();

    // 1. Buscar o crear cliente por email
    db.get('SELECT id FROM cliente WHERE email = ?', [payer.email], (err, row) => {
      if (err) {
        console.error("Error al buscar cliente:", err.message);
        return res.status(500).json({ error: "Error al buscar cliente" });
      }

      function continuarConCliente(clienteId) {
        // 2. Crea el pago primero
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

          // Transforma los productos para guardar toda la info necesaria
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
              if (err) {
                console.error("Error al guardar carrito pendiente:", err.message);
                return res.status(500).json({ error: "Error al guardar el carrito" });
              }
              res.status(200).json({ payment_url: paymentResponse.payment_url });
            }
          );
        }).catch(error => {
          console.error("Error al crear el pago:", error);
          res.status(500).json({ error: error.message || "Error al crear el pago" });
        });
      }

      if (row) {
        // Cliente ya existe
        continuarConCliente(row.id);
      } else {
        // Crear cliente nuevo
        db.run(
          'INSERT INTO cliente (nombre, email) VALUES (?, ?)',
          [payer.name || 'Sin Nombre', payer.email],
          function (err) {
            if (err) {
              console.error("Error al crear cliente:", err.message);
              return res.status(500).json({ error: "Error al crear cliente" });
            }
            continuarConCliente(this.lastID);
          }
        );
      }
    });
  } catch (error) {
    console.error("Error general en create_payment:", error);
    res.status(500).json({ error: error.message || "Error al crear el pago" });
  }
});

// --- WEBHOOK DE MERCADOPAGO ---

app.post("/webhook/mercadopago", async (req, res) => {
  console.log("Webhook recibido:", JSON.stringify(req.body, null, 2));
  const event = req.body;

  if (event.type === "payment" && event.data && event.data.id) {
    const paymentId = event.data.id;

    try {
      const mpResponse = await fetch(
        `https://api.mercadopago.com/v1/payments/${paymentId}`,
        {
          headers: {
            Authorization:
              "Bearer APP_USR-7576810649603357-043000-976f552a337069eee60ba704f37d774e-2407886899",
          },
        }
      );
      const paymentData = await mpResponse.json();
      console.log("paymentData:", paymentData);

      const identifier = paymentData.metadata?.identifier;
      console.log("Buscando carrito con order_id:", identifier);

      db.get(
        `SELECT * FROM carrito_pendiente WHERE order_id = ?`,
        [identifier],
        (err, carrito) => {
          if (err || !carrito) {
            console.error("Webhook: Carrito no encontrado:", err?.message);
            return res
              .status(200)
              .json({ message: "Carrito no encontrado, ignorado" });
          }

          const productos = JSON.parse(carrito.productos);
          const cliente_id = carrito.cliente_id;
          const total = carrito.total;
          const fecha = new Date().toISOString().slice(0, 19).replace("T", " ");

          db.run(
            `INSERT INTO pedidos (cliente_id, fecha, total) VALUES (?, ?, ?)`,
            [cliente_id, fecha, total],
            function (err) {
              if (err) {
                console.error(
                  "Webhook: Error al insertar pedido:",
                  err.message
                );
                return res
                  .status(500)
                  .json({ error: "Error al registrar el pedido" });
              }
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

              // Borra el carrito pendiente
              db.run(`DELETE FROM carrito_pendiente WHERE order_id = ?`, [
                identifier,
              ]);

              console.log("Webhook: Pedido y detalles guardados correctamente");
              res.status(200).json({
                message: "Pedido registrado correctamente",
                pedido_id,
              });
            }
          );
        }
      );
    } catch (error) {
      console.error(
        "Error al consultar el pago en MercadoPago:",
        error.message
      );
      res
        .status(500)
        .json({ error: "Error al consultar el pago en MercadoPago" });
    }
  } else {
    res.status(200).json({ message: "Evento ignorado" });
  }
});

console.log("VEXOR_PROJECT:", process.env.VEXOR_PROJECT);
console.log("VEXOR_PUBLISHABLE_KEY:", process.env.VEXOR_PUBLISHABLE_KEY);
console.log("VEXOR_SECRET_KEY:", process.env.VEXOR_SECRET_KEY);

// apartado base de datos toy chato //

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
    if (err) {
      console.error("Error al obtener producto:", err.message);
      res.status(500).json({ error: "Error al obtener producto" });
    } else if (!row) {
      res.status(404).json({ error: "Producto no encontrado" });
    } else {
      res.status(200).json(row);
    }
  });
});

app.get("/productos", (req, res) => {
  const query = `
        SELECT p.id, p.nombre, p.descripcion, p.precio, 
               IFNULL(SUM(i.cantidad), 0) AS stock
        FROM productos p
        LEFT JOIN inventario i ON p.id = i.producto_id
        GROUP BY p.id
    `;

  db.all(query, (err, rows) => {
    if (err) {
      console.error("Error al obtener productos:", err.message);
      res.status(500).json({ error: "Error al obtener productos" });
    } else {
      res.status(200).json(rows);
    }
  });
});

// Conexión a la base de datos SQLite
const sqliteDb = new sqlite3.Database("./database.db", (err) => {
  if (err) {
    console.error("Error al conectar con la base de datos:", err.message);
  } else {
    console.log("Conectado a la base de datos SQLite");
  }
});

// Endpoint para obtener todas las tablas y registros
app.get("/api/database", (req, res) => {
  sqliteDb.all(
    "SELECT name FROM sqlite_master WHERE type='table'",
    [],
    (err, tables) => {
      if (err) {
        console.error("Error al obtener las tablas:", err.message);
        return res
          .status(500)
          .json({ error: "Error al obtener las tablas de la base de datos" });
      }

      const database = {};
      let pending = tables.length;

      if (pending === 0) {
        return res.json(database);
      }

      tables.forEach((table) => {
        sqliteDb.all(`SELECT * FROM ${table.name}`, [], (err, rows) => {
          if (err) {
            console.error(
              `Error al obtener registros de la tabla ${table.name}:`,
              err.message
            );
            return res.status(500).json({
              error: `Error al obtener registros de la tabla ${table.name}`,
            });
          }

          database[table.name] = rows;
          pending -= 1;

          if (pending === 0) {
            res.json(database);
          }
        });
      });
    }
  );
});

////////////////////////////////////////////

// Servir archivos estáticos desde la carpeta "public"
app.use(express.static("public"));

// Endpoint para generar reportes en formato PDF
app.get("/api/reportes", async (req, res) => {
  const { tipo } = req.query;

  if (!tipo) {
    return res
      .status(400)
      .json({ error: "Debe especificar el tipo de reporte" });
  }

  const doc = new PDFDocument();
  const filename = `reporte_${tipo}_${Date.now()}.pdf`;
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  res.setHeader("Content-Type", "application/pdf");

  doc.pipe(res);

  try {
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
      db.all(query, [], (err, rows) => {
        if (err) {
          console.error(
            "Error al generar reporte de productos vendidos:",
            err.message
          );
          doc.text("Error al generar reporte de productos vendidos.");
          doc.end();
          return;
        }
        rows.forEach((row) => {
          doc.text(
            `Producto: ${row.nombre} - Total Vendido: ${row.total_vendido}`
          );
        });
        doc.end();
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
      db.all(query, [], (err, rows) => {
        if (err) {
          console.error(
            "Error al generar reporte de productos más vendidos:",
            err.message
          );
          doc.text("Error al generar reporte de productos más vendidos.");
          doc.end();
          return;
        }
        rows.forEach((row) => {
          doc.text(
            `Producto: ${row.nombre} - Total Vendido: ${row.total_vendido}`
          );
        });
        doc.end();
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
      db.all(query, [], (err, rows) => {
        if (err) {
          console.error(
            "Error al generar reporte de categorías más vendidas:",
            err.message
          );
          doc.text("Error al generar reporte de categorías más vendidas.");
          doc.end();
          return;
        }
        rows.forEach((row) => {
          doc.text(
            `Categoría: ${row.categoria} - Total Vendido: ${row.total_vendido}`
          );
        });
        doc.end();
      });
    } else {
      doc.text("Tipo de reporte no válido.");
      doc.end();
    }
  } catch (error) {
    console.error("Error al generar el reporte:", error.message);
    doc.text("Error al generar el reporte.");
    doc.end();
  }
});

// Configuración de Nodemailer
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
  console.error(
    "Error: Variables de entorno EMAIL_USER o EMAIL_PASSWORD no están configuradas"
  );
  process.exit(1); // Finalizar la aplicación si las credenciales no están configuradas
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "ferremasreportes@gmail.com",
    pass: "fsmh yauw zupi wjyh",
  },
});

// Endpoint para enviar el PDF por correo
app.post("/api/enviar-reporte", async (req, res) => {
  const { email, tipo } = req.body;

  if (!email || !tipo) {
    console.error(
      "Error: Falta el correo o el tipo de reporte en la solicitud"
    );
    return res
      .status(400)
      .json({ error: "Debe proporcionar un correo y el tipo de reporte" });
  }

  const doc = new PDFDocument();
  const filename = `reporte_${tipo}_${Date.now()}.pdf`;
  const tempDir = "./temp";
  const filePath = `${tempDir}/${filename}`;

  try {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }

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
      attachments: [
        {
          filename,
          path: filePath,
        },
      ],
    };

    await transporter.sendMail(mailOptions);
    fs.unlinkSync(filePath);

    console.log(
      `Correo enviado exitosamente a ${email} con el reporte ${tipo}`
    );
    res.status(200).json({ message: "Correo enviado exitosamente" });
  } catch (error) {
    console.error(
      "Error al procesar la solicitud en /api/enviar-reporte:",
      error.message
    );

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.status(500).json({ error: "Error al enviar el correo" });
  }
});

// Endpoint para obtener los pedidos realizados con nombre de cliente
app.get("/api/pedidos", (req, res) => {
  const query = `
        SELECT pedidos.id, pedidos.fecha, pedidos.total, cliente.nombre AS cliente
        FROM pedidos
        LEFT JOIN cliente ON pedidos.cliente_id = cliente.id
        ORDER BY pedidos.fecha DESC
    `;
  db.all(query, [], (err, rows) => {
    if (err) {
      console.error("Error al obtener pedidos:", err.message);
      res.status(500).json({ error: "Error al obtener pedidos" });
    } else {
      res.json(rows);
    }
  });
});

// Endpoint para obtener detalles de un solo pedido
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
    if (err) {
      console.error("Error al obtener pedidos con detalles:", err.message);
      res.status(500).json({ error: "Error al obtener pedidos con detalles" });
    } else {
      // Agrupar por pedido
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
        // Solo agrega si hay detalle (d.nombre_producto no es null)
        if (row.nombre_producto) {
          pedidos[row.pedido_id].productos.push({
            nombre_producto: row.nombre_producto,
            cantidad: row.cantidad,
            valor_producto: row.valor_producto,
            subtotal: row.subtotal,
          });
        }
      });
      // Si se pidió un solo pedido, retorna solo ese objeto (conversión a número)
      if (pedidoId) {
        if (pedidos[Number(pedidoId)]) {
          res.json(pedidos[Number(pedidoId)]);
        } else {
          // Si no hay detalles ni pedido, busca el pedido solo
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
    }
  });
});

app.listen(port, () => {
  console.log(`Servidor en http://localhost:${port}`);
});
