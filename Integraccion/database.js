import sqlite3 from 'sqlite3';

// Inicializar la base de datos
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('Error al conectar con la base de datos:', err.message);
    } else {
        console.log('Conectado a la base de datos SQLite.');
    }
});

// Crear la tabla "cart" para almacenar los productos del carrito
db.serialize(() => {
    // Crear tabla "cliente"
    db.run(`
        CREATE TABLE IF NOT EXISTS cliente (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            direccion TEXT,
            telefono TEXT,
            email TEXT
        )
    `, (err) => {
        if (err) console.error('Error al crear la tabla cliente:', err.message);
    });

    // Crear tabla "usuario"
    db.run(`
        CREATE TABLE IF NOT EXISTS usuario (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            rol TEXT NOT NULL
        )
    `, (err) => {
        if (err) console.error('Error al crear la tabla usuario:', err.message);
    });

    // Crear tabla "productos"
    db.run(`
        CREATE TABLE IF NOT EXISTS productos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            descripcion TEXT,
            precio REAL NOT NULL,
            categoria_id INTEGER,
            FOREIGN KEY (categoria_id) REFERENCES categorias(id)
        )
    `, (err) => {
        if (err) console.error('Error al crear la tabla productos:', err.message);
    });

    // Agregar columna 'imagen' a la tabla 'productos'
    db.run(`
        ALTER TABLE productos ADD COLUMN imagen TEXT
    `, (err) => {
        if (err) console.error('Error al agregar la columna imagen a la tabla productos:', err.message);
    });

    // Crear tabla "pedidos"
    db.run(`
        CREATE TABLE IF NOT EXISTS pedidos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cliente_id INTEGER NOT NULL,
            fecha TEXT NOT NULL,
            total REAL NOT NULL,
            FOREIGN KEY (cliente_id) REFERENCES cliente(id)
        )
    `, (err) => {
        if (err) console.error('Error al crear la tabla pedidos:', err.message);
    });

    // Crear tabla "empleados"
    db.run(`
        CREATE TABLE IF NOT EXISTS empleados (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            puesto TEXT NOT NULL,
            sucursal_id INTEGER,
            FOREIGN KEY (sucursal_id) REFERENCES sucursales(id)
        )
    `, (err) => {
        if (err) console.error('Error al crear la tabla empleados:', err.message);
    });

    // Crear tabla "categorias"
    db.run(`
        CREATE TABLE IF NOT EXISTS categorias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL
        )
    `, (err) => {
        if (err) console.error('Error al crear la tabla categorias:', err.message);
    });

    // Crear tabla "sucursales"
    db.run(`
        CREATE TABLE IF NOT EXISTS sucursales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            direccion TEXT NOT NULL
        )
    `, (err) => {
        if (err) console.error('Error al crear la tabla sucursales:', err.message);
    });

    // Crear tabla "inventario"
    db.run(`
        CREATE TABLE IF NOT EXISTS inventario (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            producto_id INTEGER NOT NULL,
            sucursal_id INTEGER NOT NULL,
            cantidad INTEGER NOT NULL,
            FOREIGN KEY (producto_id) REFERENCES productos(id),
            FOREIGN KEY (sucursal_id) REFERENCES sucursales(id)
        )
    `, (err) => {
        if (err) console.error('Error al crear la tabla inventario:', err.message);
    });

    // Crear tabla "detalle_pedido"
    db.run(`
        CREATE TABLE IF NOT EXISTS detalle_pedido (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pedido_id INTEGER NOT NULL,
            producto_id INTEGER NOT NULL,
            nombre_producto TEXT NOT NULL,
            cantidad INTEGER NOT NULL,
            valor_producto REAL NOT NULL,
            subtotal REAL NOT NULL,
            FOREIGN KEY (pedido_id) REFERENCES pedidos(id),
            FOREIGN KEY (producto_id) REFERENCES productos(id)
        )
    `, (err) => {
        if (err) console.error('Error al crear la tabla detalle_pedido:', err.message);
    });

    // Insertar datos iniciales si las tablas están vacías
    db.serialize(() => {
        // Insertar categorías
        db.get('SELECT COUNT(*) AS count FROM categorias', (err, row) => {
            if (err) {
                console.error('Error al verificar categorias:', err.message);
            } else if (row.count === 0) {
                const categorias = [
                    'Martillos', 'Destornilladores', 'Llaves', 'Herramientas Eléctricas', 'Taladros',
                    'Sierras', 'Lijadoras', 'Materiales de Construcción', 'Materiales Básicos', 'Cemento',
                    'Arena', 'Ladrillos', 'Acabados', 'Pinturas', 'Barnices', 'Cerámicos',
                    'Equipos de Seguridad', 'Casos', 'Guantes', 'Lentes de Seguridad',
                    'Accesorios Varios', 'Tornillos y Anclajes', 'Fijaciones y Adhesivos', 'Equipos de Medición'
                ];
                const insertQuery = `INSERT INTO categorias (nombre) VALUES (?)`;
                categorias.forEach((categoria) => {
                    db.run(insertQuery, [categoria], (err) => {
                        if (err) console.error('Error al insertar categoría:', err.message);
                    });
                });
                console.log('Categorías iniciales insertadas.');
            }
        });

        // Insertar sucursales
        db.get('SELECT COUNT(*) AS count FROM sucursales', (err, row) => {
            if (err) {
                console.error('Error al verificar sucursales:', err.message);
            } else if (row.count === 0) {
                const sucursales = [
                    { nombre: 'Sucursal Centro', direccion: 'Av. Principal 123, Santiago Centro' },
                    { nombre: 'Sucursal Norte', direccion: 'Calle Norte 456, Huechuraba' },
                    { nombre: 'Sucursal Sur', direccion: 'Av. Sur 789, La Florida' },
                    { nombre: 'Sucursal Este', direccion: 'Camino Este 101, Las Condes' }
                ];
                const insertQuery = `INSERT INTO sucursales (nombre, direccion) VALUES (?, ?)`;
                sucursales.forEach((sucursal) => {
                    db.run(insertQuery, [sucursal.nombre, sucursal.direccion], (err) => {
                        if (err) console.error('Error al insertar sucursal:', err.message);
                    });
                });
                console.log('Sucursales iniciales insertadas.');
            }
        });

        // Insertar productos
        db.get('SELECT COUNT(*) AS count FROM productos', (err, row) => {
            if (err) {
                console.error('Error al verificar productos:', err.message);
            } else if (row.count === 0) {
                const productos = [
                    { nombre: 'Martillo de Acero', descripcion: 'Martillo resistente para construcción', precio: 12000, categoria_id: 1, imagen: './public/images/taladro.jpg' },
                    { nombre: 'Taladro Eléctrico', descripcion: 'Taladro de alta potencia', precio: 19000, categoria_id: 5, imagen: 'images/taladro.jpg' },
                    { nombre: 'Llave Inglesa', descripcion: 'Llave ajustable de acero', precio: 15000, categoria_id: 3, imagen: 'images/llave.jpg' },
                    { nombre: 'Sierra Circular', descripcion: 'Sierra para cortes precisos', precio: 17000, categoria_id: 6, imagen: 'images/sierra.jpg' },
                    { nombre: 'Cemento Portland', descripcion: 'Cemento de alta calidad', precio: 10000, categoria_id: 10, imagen: 'images/cemento.jpg' }
                ];
                const insertQuery = `INSERT INTO productos (nombre, descripcion, precio, categoria_id, imagen) VALUES (?, ?, ?, ?, ?)`;
                productos.forEach((producto) => {
                    db.run(insertQuery, [producto.nombre, producto.descripcion, producto.precio, producto.categoria_id, producto.imagen], (err) => {
                        if (err) console.error('Error al insertar producto:', err.message);
                    });
                });
                console.log('Productos iniciales insertados.');
            }
        });

        // Insertar clientes
        db.get('SELECT COUNT(*) AS count FROM cliente', (err, row) => {
            if (err) {
                console.error('Error al verificar clientes:', err.message);
            } else if (row.count === 0) {
                const clientes = [
                    { nombre: 'Juan Pérez', direccion: 'Calle Falsa 123', telefono: '123456789', email: 'juan@example.com' },
                    { nombre: 'María López', direccion: 'Av. Siempre Viva 456', telefono: '987654321', email: 'maria@example.com' },
                    { nombre: 'Carlos Gómez', direccion: 'Pasaje Los Olivos 789', telefono: '456789123', email: 'carlos@example.com' },
                    { nombre: 'Ana Torres', direccion: 'Camino Real 101', telefono: '789123456', email: 'ana@example.com' },
                    { nombre: 'Luis Ramírez', direccion: 'Av. Central 202', telefono: '321654987', email: 'luis@example.com' }
                ];
                const insertQuery = `INSERT INTO cliente (nombre, direccion, telefono, email) VALUES (?, ?, ?, ?)`;
                clientes.forEach((cliente) => {
                    db.run(insertQuery, [cliente.nombre, cliente.direccion, cliente.telefono, cliente.email], (err) => {
                        if (err) console.error('Error al insertar cliente:', err.message);
                    });
                });
                console.log('Clientes iniciales insertados.');
            }
        });

        // Insertar usuarios
        db.get('SELECT COUNT(*) AS count FROM usuario', (err, row) => {
            if (err) {
                console.error('Error al verificar usuarios:', err.message);
            } else if (row.count === 0) {
                const usuarios = [
                    { username: 'admin', password: 'admin123', rol: 'admin' },
                    { username: 'empleado1', password: 'empleado123', rol: 'empleado' },
                    { username: 'cliente1', password: 'cliente123', rol: 'cliente' },
                    { username: 'cliente2', password: 'cliente123', rol: 'cliente' },
                    { username: 'empleado2', password: 'empleado123', rol: 'empleado' }
                ];
                const insertQuery = `INSERT INTO usuario (username, password, rol) VALUES (?, ?, ?)`;
                usuarios.forEach((usuario) => {
                    db.run(insertQuery, [usuario.username, usuario.password, usuario.rol], (err) => {
                        if (err) console.error('Error al insertar usuario:', err.message);
                    });
                });
                console.log('Usuarios iniciales insertados.');
            }
        });

        // Insertar datos iniciales en inventario
        db.get('SELECT COUNT(*) AS count FROM inventario', (err, row) => {
            if (err) {
                console.error('Error al verificar inventario:', err.message);
            } else if (row.count === 0) {
                const inventario = [
                    { producto_id: 1, sucursal_id: 1, cantidad: 50 },
                    { producto_id: 2, sucursal_id: 1, cantidad: 30 },
                    { producto_id: 3, sucursal_id: 2, cantidad: 20 },
                    { producto_id: 4, sucursal_id: 3, cantidad: 15 },
                    { producto_id: 5, sucursal_id: 4, cantidad: 40 },
                    { producto_id: 1, sucursal_id: 2, cantidad: 25 },
                    { producto_id: 2, sucursal_id: 3, cantidad: 10 },
                    { producto_id: 3, sucursal_id: 4, cantidad: 5 },
                ];
                const insertQuery = `INSERT INTO inventario (producto_id, sucursal_id, cantidad) VALUES (?, ?, ?)`;
                inventario.forEach((item) => {
                    db.run(insertQuery, [item.producto_id, item.sucursal_id, item.cantidad], (err) => {
                        if (err) console.error('Error al insertar inventario:', err.message);
                    });
                });
                console.log('Inventario inicial insertado.');
            }
        });

        // Insertar datos iniciales en pedidos (opcional para reportes futuros)
        db.get('SELECT COUNT(*) AS count FROM pedidos', (err, row) => {
            if (err) {
                console.error('Error al verificar pedidos:', err.message);
            } else if (row.count === 0) {
                const pedidos = [
                    { cliente_id: 1, fecha: '2023-01-15', total: 50000 },
                    { cliente_id: 2, fecha: '2023-02-20', total: 75000 },
                    { cliente_id: 3, fecha: '2023-03-10', total: 30000 },
                ];
                const insertQuery = `INSERT INTO pedidos (cliente_id, fecha, total) VALUES (?, ?, ?)`;
                pedidos.forEach((pedido) => {
                    db.run(insertQuery, [pedido.cliente_id, pedido.fecha, pedido.total], (err) => {
                        if (err) console.error('Error al insertar pedido:', err.message);
                    });
                });
                console.log('Pedidos iniciales insertados.');
            }
        });

        // Insertar datos iniciales en detalle_pedido
        db.get('SELECT COUNT(*) AS count FROM detalle_pedido', (err, row) => {
            if (err) {
                console.error('Error al verificar detalle_pedido:', err.message);
            } else if (row.count === 0) {
                const detalles = [
                    { pedido_id: 1, producto_id: 1, nombre_producto: 'Martillo de Acero', cantidad: 2, valor_producto: 12000, subtotal: 24000 },
                    { pedido_id: 1, producto_id: 3, nombre_producto: 'Llave Inglesa', cantidad: 2, valor_producto: 13000, subtotal: 26000 },
                    { pedido_id: 2, producto_id: 2, nombre_producto: 'Taladro Eléctrico', cantidad: 3, valor_producto: 19000, subtotal: 57000 },
                    { pedido_id: 2, producto_id: 4, nombre_producto: 'Sierra Circular', cantidad: 1, valor_producto: 18000, subtotal: 18000 },
                    { pedido_id: 3, producto_id: 5, nombre_producto: 'Cemento Portland', cantidad: 3, valor_producto: 10000, subtotal: 30000 }
                ];
                const insertQuery = `INSERT INTO detalle_pedido (pedido_id, producto_id, nombre_producto, cantidad, valor_producto, subtotal) VALUES (?, ?, ?, ?, ?, ?)`;
                detalles.forEach((detalle) => {
                    db.run(insertQuery, [detalle.pedido_id, detalle.producto_id, detalle.nombre_producto, detalle.cantidad, detalle.valor_producto, detalle.subtotal], (err) => {
                        if (err) console.error('Error al insertar detalle_pedido:', err.message);
                    });
                });
                console.log('Detalles de pedidos iniciales insertados.');
            }
        });

        // Insertar datos iniciales en categorías (si no existen)
        db.get('SELECT COUNT(*) AS count FROM categorias', (err, row) => {
            if (err) {
                console.error('Error al verificar categorías:', err.message);
            } else if (row.count === 0) {
                const categorias = [
                    { nombre: 'Herramientas Manuales' },
                    { nombre: 'Herramientas Eléctricas' },
                    { nombre: 'Materiales de Construcción' },
                ];
                const insertQuery = `INSERT INTO categorias (nombre) VALUES (?)`;
                categorias.forEach((categoria) => {
                    db.run(insertQuery, [categoria.nombre], (err) => {
                        if (err) console.error('Error al insertar categoría:', err.message);
                    });
                });
                console.log('Categorías iniciales insertadas.');
            }
        });
    });
});

export default db;