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
    });
});

export default db;