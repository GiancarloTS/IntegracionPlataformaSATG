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
  publishableKey:
    "vx_prod_pk_769151bb2eb2ce214cdea3cca029865d_d131cd14_e9d4_4190_bdf1_9fd72ea67da2_7b62d4",
  projectId: "680dd8ff54ab54c284980947",
  apiKey:
    "vx_prod_sk_6508f65ae151ebc5e8037154a87c21d7_bc0d9532_63ac_4cd4_a52c_a156fe34160a_fce224",
});

app.use(cors());
app.use(express.json());

// =======================
// FLUJO DE PAGO Y CARRITO
// =======================

// Endpoint para crear pago y guardar carrito pendiente
app.post("/create_payment", async (req, res) => {
  const { products, payer } = req.body;
  if (!products || !Array.isArray(products) || products.length === 0) {
    return res
      .status(400)
      .json({
        error: "Faltan datos de los productos o el formato es incorrecto",
      });
  }
  if (!payer || !payer.email) {
    return res
      .status(400)
      .json({ error: "El email del comprador es obligatorio" });
  }
  if (products.some((p) => !p.producto_id)) {
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
    // Buscar o crear cliente por email
    db.get(
      "SELECT id FROM cliente WHERE email = ?",
      [payer.email],
      (err, row) => {
        if (err)
          return res.status(500).json({ error: "Error al buscar cliente" });

        function continuarConCliente(clienteId) {
          vexorInstance.pay
            .mercadopago({
              items,
              payer: {
                email: payer.email,
                name: payer.name || "",
                surname: payer.surname || "",
              },
            })
            .then((paymentResponse) => {
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
                `INSERT INTO carrito_pendiente (id, cliente_id, productos, total, fecha_creacion, pref_id, order_id, payer_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  carritoId,
                  clienteId,
                  JSON.stringify(productosParaGuardar),
                  productosParaGuardar.reduce((sum, p) => sum + p.subtotal, 0),
                  new Date().toISOString(),
                  prefId,
                  identifier,
                  payer.email, // <-- aquí se guarda el email ingresado en el carrito
                ],
                (err) => {
                  if (err)
                    return res
                      .status(500)
                      .json({ error: "Error al guardar el carrito" });
                  res
                    .status(200)
                    .json({ payment_url: paymentResponse.payment_url });
                }
              );
            })
            .catch((error) => {
              res
                .status(500)
                .json({ error: error.message || "Error al crear el pago" });
            });
        }

        if (row) {
          continuarConCliente(row.id);
        } else {
          db.run(
            "INSERT INTO cliente (nombre, email) VALUES (?, ?)",
            [payer.name || "Sin Nombre", payer.email],
            function (err) {
              if (err)
                return res
                  .status(500)
                  .json({ error: "Error al crear cliente" });
              continuarConCliente(this.lastID);
            }
          );
        }
      }
    );
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
            Authorization: `Bearer APP_USR-7576810649603357-043000-976f552a337069eee60ba704f37d774e-2407886899`,
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
              if (err)
                return res
                  .status(500)
                  .json({ error: "Error al registrar el pedido" });
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
              const payerEmail = carrito.payer_email;
              // Obtener email del cliente y enviar correo de confirmación
              db.get(
                "SELECT nombre FROM cliente WHERE id = ?",
                [cliente_id],
                (err, cliente) => {
                  const nombreCliente =
                    !err && cliente && cliente.nombre ? cliente.nombre : "";
                  if (payerEmail) {
                    const mailOptions = {
                      from: "ferremasreportes@gmail.com",
                      to: payerEmail,
                      subject: "Confirmación de pago recibido",
                      text: `Hola ${nombreCliente},\n\nTu pago ha sido confirmado y tu pedido #${pedido_id} ha sido registrado correctamente.\n\n¡Gracias por tu compra!`,
                    };
                    transporter.sendMail(mailOptions, (error, info) => {
                      if (error) {
                        console.error(
                          "Error al enviar correo de confirmación:",
                          error
                        );
                      }
                    });
                  }
                }
              );

              db.run(`DELETE FROM carrito_pendiente WHERE order_id = ?`, [
                identifier,
              ]);
              res.status(200).json({
                message: "Pedido registrado correctamente",
                pedido_id,
              });
            }
          );
        }
      );
    } catch (error) {
      res
        .status(500)
        .json({ error: "Error al consultar el pago en MercadoPago" });
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
    if (err)
      return res.status(500).json({ error: "Error al obtener producto" });
    if (!row) return res.status(404).json({ error: "Producto no encontrado" });
    res.status(200).json(row);
  });
});

// Obtener todos los productos
app.get("/productos", (req, res) => {
  const query = `
    SELECT p.id, p.nombre, p.descripcion, p.precio, p.imagen, 
           IFNULL(SUM(i.cantidad), 0) AS stock
    FROM productos p
    LEFT JOIN inventario i ON p.id = i.producto_id
    GROUP BY p.id
  `;
  db.all(query, (err, rows) => {
    if (err)
      return res.status(500).json({ error: "Error al obtener productos" });
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
      if (err)
        return res
          .status(500)
          .json({ error: "Error al obtener las tablas de la base de datos" });

      const database = {};
      let pending = tables.length;
      if (pending === 0) return res.json(database);

      tables.forEach((table) => {
        sqliteDb.all(`SELECT * FROM ${table.name}`, [], (err, rows) => {
          if (err)
            return res
              .status(500)
              .json({
                error: `Error al obtener registros de la tabla ${table.name}`,
              });
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

if (!"ferremasreportes@gmail.com" || !"fsmh yauw zupi wjyh") {
  console.error(
    "Error: Variables de entorno EMAIL_USER o EMAIL_PASSWORD no están configuradas"
  );
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "ferremasreportes@gmail.com",
    pass: "fsmh yauw zupi wjyh",
  },
});
app.get("/api/reportes", async (req, res) => {
  const tipo = req.query.tipo;
  if (!tipo) {
    return res.status(400).send("Tipo de reporte requerido");
  }

  const doc = new PDFDocument();
  const filename = `reporte_${tipo}_${Date.now()}.pdf`;

  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "application/pdf");
  doc.pipe(res);
  // === Agrega la fecha actual al título ===
  const fechaActual = new Date().toLocaleDateString("es-CL");
  doc
    .fontSize(18)
    .text(`Reporte: ${tipo.replace("_", " ").toUpperCase()} - ${fechaActual}`, {
      align: "center",
    });
  doc.moveDown();

  let query;
  if (tipo === "productos_vendidos") {
    query = `
      SELECT p.nombre, SUM(i.cantidad) AS total_vendido
      FROM inventario i
      JOIN productos p ON i.producto_id = p.id
      GROUP BY p.id
      ORDER BY total_vendido DESC
    `;
  } else if (tipo === "mas_vendidos") {
    query = `
      SELECT p.nombre, SUM(i.cantidad) AS total_vendido
      FROM inventario i
      JOIN productos p ON i.producto_id = p.id
      GROUP BY p.id
      ORDER BY total_vendido DESC
      LIMIT 5
    `;
  } else if (tipo === "categorias_mas_vendidas") {
    query = `
      SELECT c.nombre AS categoria, SUM(i.cantidad) AS total_vendido
      FROM inventario i
      JOIN productos p ON i.producto_id = p.id
      JOIN categorias c ON p.categoria_id = c.id
      GROUP BY c.id
      ORDER BY total_vendido DESC
    `;
  } else if (tipo === "inventario_actual") {
    query = `
      SELECT p.nombre AS producto, i.cantidad, s.nombre AS sucursal
      FROM inventario i
      JOIN productos p ON i.producto_id = p.id
      JOIN sucursales s ON i.sucursal_id = s.id
      ORDER BY s.nombre, p.nombre
    `;
    db.all(query, [], (err, rows) => {
      if (err) {
        doc.text("Error al generar el reporte de inventario.");
        doc.end();
        return;
      }
      doc
        .fontSize(14)
        .text("Inventario actual por sucursal:", { underline: true });
      doc.moveDown(0.5);
      rows.forEach((row) => {
        doc.text(
          `Sucursal: ${row.sucursal} | Producto: ${row.producto} | Cantidad: ${row.cantidad}`
        );
      });
      doc.end();
    });
    return; // Importante: salir para no ejecutar el resto del endpoint
  } else if (tipo === "empleados") {
    query = `
    SELECT e.id, e.nombre, e.puesto, s.nombre AS sucursal
    FROM empleados e
    LEFT JOIN sucursales s ON e.sucursal_id = s.id
    ORDER BY e.nombre
  `;
    db.all(query, [], (err, rows) => {
      if (err) {
        doc.text("Error al generar el reporte de empleados.");
        doc.end();
        return;
      }
      doc.fontSize(14).text("Lista de empleados:", { underline: true });
      doc.moveDown(0.5);
      rows.forEach((row) => {
        doc.text(
          `Nombre: ${row.nombre} | Puesto: ${row.puesto} | Sucursal: ${
            row.sucursal || row.sucursal_id
          }`
        );
      });
      doc.end();
    });
    return;
  }

  // El resto de tu código para los otros reportes...
  db.all(query, [], (err, rows) => {
    if (err) {
      doc.text("Error al generar el reporte.");
      doc.end();
      return;
    }
    rows.forEach((row) => {
      if (tipo === "categorias_mas_vendidas") {
        doc.text(
          `Categoría: ${row.categoria} - Total Vendido: ${row.total_vendido}`
        );
      } else {
        doc.text(
          `Producto: ${row.nombre} - Total Vendido: ${row.total_vendido}`
        );
      }
    });
    doc.end();
  });
});
// Generar y enviar reporte PDF por correo
app.post("/api/enviar-reporte", async (req, res) => {
  const { email, tipo } = req.body;
  if (!email || !tipo) {
    return res
      .status(400)
      .json({ error: "Debe proporcionar un correo y el tipo de reporte" });
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
    } else if (tipo === "empleados") {
      const query = `
    SELECT e.id, e.nombre, e.puesto, s.nombre AS sucursal
    FROM empleados e
    LEFT JOIN sucursales s ON e.sucursal_id = s.id
    ORDER BY e.nombre
  `;
      const rows = await new Promise((resolve, reject) => {
        db.all(query, [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
      doc.fontSize(14).text("Lista de empleados:", { underline: true });
      doc.moveDown(0.5);
      rows.forEach((row) => {
        doc.text(
          `Nombre: ${row.nombre} | Puesto: ${row.puesto} | Sucursal: ${
            row.sucursal || row.sucursal_id
          }`
        );
      });
    }

    doc.end();

    await new Promise((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    const mailOptions = {
      from: "ferremasreportes@gmail.com",
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
app.get("/api/ventas", (req, res) => {
  const query = `
    SELECT v.id, v.fecha, c.nombre AS cliente, v.total
    FROM ventas v
    JOIN cliente c ON v.cliente_id = c.id
    ORDER BY v.fecha DESC
  `;
  db.all(query, [], (err, rows) => {
    if (err) {
      console.error("Error al obtener ventas:", err);
      return res.json([]); // Devuelve array vacío en caso de error
    }
    res.json(rows);
  });
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
    if (err)
      return res
        .status(500)
        .json({ error: "Error al obtener pedidos con detalles" });

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
// Obtener inventario completo para el bodeguero
app.get("/api/inventario", (req, res) => {
  const query = `
    SELECT p.nombre AS producto, 
           i.cantidad, 
           s.nombre AS ubicacion
    FROM inventario i
    JOIN productos p ON i.producto_id = p.id
    JOIN sucursales s ON i.sucursal_id = s.id
    ORDER BY p.nombre, s.nombre
  `;
  db.all(query, [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: "Error al obtener inventario" });
    } else {
      res.json(rows);
    }
  });
});
app.post("/api/inventario/actualizar", (req, res) => {
  const { producto, cantidad } = req.body;
  // Busca el id del producto
  db.get(
    "SELECT id FROM productos WHERE nombre = ?",
    [producto],
    (err, prod) => {
      if (err || !prod) {
        return res.status(400).json({ error: "Producto no encontrado" });
      }
      // Actualiza la cantidad en inventario (aquí asume sucursal 1)
      db.run(
        "UPDATE inventario SET cantidad = ? WHERE producto_id = ?",
        [cantidad, prod.id],
        function (err) {
          if (err) {
            res.status(500).json({ error: "Error al actualizar inventario" });
          } else {
            res.json({ success: true });
          }
        }
      );
    }
  );
});
// Registrar producto y stock inicial vista vendedor //
import multer from "multer";
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "public/images/");
  },
  filename: function (req, file, cb) {
    // Si ya existe un archivo con ese nombre, puedes agregar un timestamp si quieres evitar sobrescribir
    cb(null, file.originalname);
  },
});
const upload = multer({ storage });
app.post("/api/productos", upload.single("imagen-producto"), (req, res) => {
  const { nombre, descripcion, precio, stock, sucursal_id, categoria_id } =
    req.body;
  const imagen = req.file ? req.file.originalname : null; // Guarda el nombre original

  if (!nombre || !precio || !sucursal_id || !categoria_id || !imagen) {
    return res.status(400).json({ error: "Faltan datos obligatorios" });
  }

  db.run(
    "INSERT INTO productos (nombre, descripcion, precio, categoria_id, imagen) VALUES (?, ?, ?, ?, ?)",
    [nombre, descripcion, precio, categoria_id, imagen],
    function (err) {
      if (err) {
        console.error("Error al registrar producto:", err);
        return res.status(500).json({ error: "Error al registrar producto" });
      }
      const productoId = this.lastID;
      db.run(
        "INSERT INTO inventario (producto_id, sucursal_id, cantidad) VALUES (?, ?, ?)",
        [productoId, sucursal_id, stock || 0],
        function (err2) {
          if (err2) {
            console.error("Error al registrar inventario:", err2);
            return res
              .status(500)
              .json({
                error: "Producto creado, pero error al asignar stock inicial",
              });
          }
          res.json({
            message: "Producto y stock inicial registrados correctamente",
            id: productoId,
          });
        }
      );
    }
  );
});
app.get("/api/categorias", (req, res) => {
  db.all("SELECT id, nombre FROM categorias", [], (err, rows) => {
    if (err)
      return res.status(500).json({ error: "Error al obtener categorías" });
    res.json(rows);
  });
});
app.get("/api/sucursales", (req, res) => {
  db.all("SELECT id, nombre FROM sucursales", [], (err, rows) => {
    if (err)
      return res.status(500).json({ error: "Error al obtener sucursales" });
    res.json(rows);
  });
});
// Listar todos los productos con nombre de categoría
app.get("/api/productos/all", (req, res) => {
  db.all(
    `
    SELECT p.*, c.nombre as categoria_nombre
    FROM productos p
    LEFT JOIN categorias c ON p.categoria_id = c.id
    ORDER BY p.id DESC
  `,
    [],
    (err, rows) => {
      if (err)
        return res.status(500).json({ error: "Error al obtener productos" });
      res.json(rows);
    }
  );
});

// Obtener un producto por id
app.get("/api/productos/:id", (req, res) => {
  db.get(
    "SELECT * FROM productos WHERE id = ?",
    [req.params.id],
    (err, row) => {
      if (err || !row)
        return res.status(404).json({ error: "Producto no encontrado" });
      res.json(row);
    }
  );
});

// Actualizar producto (con imagen opcional)
app.put("/api/productos/:id", upload.single("imagen-producto"), (req, res) => {
  const { nombre, descripcion, precio, categoria_id } = req.body;
  let query =
    "UPDATE productos SET nombre=?, descripcion=?, precio=?, categoria_id=?";
  let params = [nombre, descripcion, precio, categoria_id];
  if (req.file) {
    query += ", imagen=?";
    params.push(req.file.originalname);
  }
  query += " WHERE id=?";
  params.push(req.params.id);
  db.run(query, params, function (err) {
    if (err)
      return res.status(500).json({ error: "Error al actualizar producto" });
    res.json({ message: "Producto actualizado" });
  });
});
app.get('/api/ventas', (req, res) => {
  let query = `
    SELECT v.id, v.fecha, c.nombre AS cliente, v.total
    FROM ventas v
    JOIN cliente c ON v.cliente_id = c.id
  `;
  const params = [];
  if (req.query.mes && req.query.anio) {
    query += ' WHERE strftime("%m", v.fecha) = ? AND strftime("%Y", v.fecha) = ?';
    params.push(req.query.mes.padStart(2, '0'), req.query.anio);
  }
  query += ' ORDER BY v.fecha DESC';
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Error al obtener ventas' });
    res.json(rows);
  });
});
// Eliminar producto
app.delete("/api/productos/:id", (req, res) => {
  db.run("DELETE FROM productos WHERE id=?", [req.params.id], function (err) {
    if (err)
      return res.status(500).json({ error: "Error al eliminar producto" });
    res.json({ message: "Producto eliminado" });
  });
});
// =======================
// SERVIR ARCHIVOS ESTÁTICOS Y LEVANTAR SERVIDOR
// =======================
app.use(express.static("public"));

app.listen(3000, "0.0.0.0", () => {
  console.log(`Servidor en http://localhost:${port}`);
});
