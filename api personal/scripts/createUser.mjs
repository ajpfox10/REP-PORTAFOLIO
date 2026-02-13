#!/usr/bin/env node
// scripts/createUser.mjs
import { createSequelize } from '../src/db/sequelize.js';
import { hashPassword } from '../src/auth/password.js';
import readline from 'readline';
import crypto from 'crypto';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise(resolve => rl.question(query, resolve));

function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function generatePassword(length = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars[Math.floor(Math.random() * chars.length)];
  }
  return password;
}

async function main() {
  console.log('\n👤 ========================================');
  console.log('👤 CREAR NUEVO USUARIO - personalv5');
  console.log('👤 ========================================\n');

  try {
    // Email
    let email = '';
    while (!validateEmail(email)) {
      email = await question('📧 Email: ');
      if (!validateEmail(email)) {
        console.log('❌ Email inválido. Debe tener formato usuario@dominio.com');
      }
    }

    // Nombre
    const nombre = await question('👤 Nombre completo (opcional): ');

    // Contraseña
    console.log('\n🔑 Opciones de contraseña:');
    console.log('  1. Ingresar manualmente');
    console.log('  2. Generar automáticamente');
    const passOption = await question('  Seleccioná una opción (1/2): ');

    let password = '';
    if (passOption === '2') {
      password = generatePassword();
      console.log(`   ✅ Contraseña generada: ${password}`);
      console.log(`   ⚠️  Guardala en un lugar seguro, no se mostrará nuevamente.`);
    } else {
      password = await question('🔑 Contraseña (mínimo 8 caracteres): ');
      if (password.length < 8) {
        throw new Error('La contraseña debe tener al menos 8 caracteres');
      }
      const confirm = await question('🔑 Confirmar contraseña: ');
      if (password !== confirm) {
        throw new Error('Las contraseñas no coinciden');
      }
    }

    // Rol
    const roleId = await question('🎭 ID de rol (default: 1 - admin): ');
    const roleIdNum = roleId.trim() ? parseInt(roleId, 10) : 1;
    if (isNaN(roleIdNum) || roleIdNum <= 0) {
      throw new Error('ID de rol inválido');
    }

    console.log('\n🔄 Conectando a base de datos...');
    const sequelize = createSequelize();
    await sequelize.authenticate();
    console.log('✅ Conexión exitosa');

    // Verificar si el email ya existe
    const [existing] = await sequelize.query(
      `SELECT id, email FROM usuarios WHERE email = :email AND deleted_at IS NULL`,
      { replacements: { email } }
    );

    if (existing.length > 0) {
      throw new Error(`❌ El email ${email} ya está registrado (ID: ${existing[0].id})`);
    }

    // Verificar que el rol existe
    const [roleCheck] = await sequelize.query(
      `SELECT id, nombre FROM roles WHERE id = :roleId AND deleted_at IS NULL`,
      { replacements: { roleId: roleIdNum } }
    );

    if (roleCheck.length === 0) {
      throw new Error(`❌ El rol ID ${roleIdNum} no existe`);
    }

    // Hash de contraseña
    const passwordHash = await hashPassword(password);

    // Crear usuario
    const [result] = await sequelize.query(
      `INSERT INTO usuarios (email, nombre, password, estado, created_by, created_at)
       VALUES (:email, :nombre, :passwordHash, 'activo', 1, NOW())`,
      {
        replacements: {
          email,
          nombre: nombre.trim() || null,
          passwordHash
        }
      }
    );

    const userId = result.insertId;

    // Asignar rol
    await sequelize.query(
      `INSERT INTO usuarios_roles (usuario_id, rol_id, created_at)
       VALUES (:userId, :roleId, NOW())`,
      { replacements: { userId, roleId: roleIdNum } }
    );

    console.log('\n✅ ========================================');
    console.log('✅ USUARIO CREADO EXITOSAMENTE');
    console.log('✅ ========================================');
    console.log(`  🆔 ID:        ${userId}`);
    console.log(`  📧 Email:     ${email}`);
    console.log(`  👤 Nombre:    ${nombre || '(no especificado)'}`);
    console.log(`  🎭 Rol:       ${roleCheck[0].nombre} (ID: ${roleIdNum})`);
    console.log(`  🔐 Estado:    activo`);
    console.log(`  📅 Creado:    ${new Date().toISOString().split('T')[0]}`);
    console.log('✅ ========================================\n');

    await sequelize.close();
    rl.close();

  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    rl.close();
    process.exit(1);
  }
}

main();