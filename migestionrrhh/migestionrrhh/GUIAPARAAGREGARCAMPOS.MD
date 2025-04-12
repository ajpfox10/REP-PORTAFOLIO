# 🛠️ Guía ultra detallada paso a paso: Cómo agregar un nuevo campo a un módulo en el sistema RRHH

Esta guía está pensada para cualquier persona (incluso sin experiencia previa), y explica cómo agregar un nuevo campo a un módulo en NestJS + Sequelize + Swagger, paso por paso y con ejemplos.

---

## ✅ ¿Qué significa "agregar un campo"?
Significa que queremos que una entidad (por ejemplo, un usuario) tenga un nuevo dato, como "teléfono de emergencia", y que:

- Se guarde en la base de datos
- Se valide correctamente
- Aparezca en Swagger
- Sea usado desde los endpoints (POST, PATCH, etc.)

---

## 📦 ¿Dónde tenemos que tocar?

| Parte               | Archivo                           | ¿Qué se hace?                                  |
|--------------------|------------------------------------|------------------------------------------------|
| 🧠 Modelo Sequelize | `usuario.model.ts`                | Se agrega el campo en la base de datos         |
| ✅ DTOs             | `usuario.dto.ts` y `actualizar-usuario.dto.ts` | Se valida el dato y se documenta Swagger |
| 📡 Controller       | `usuario.controller.ts`            | Generalmente no hay que tocar si usás DTOs     |
| 🧩 Servicio         | `usuario.service.ts`               | Solo si manejás propiedades una por una        |
| 🛢️ Base de datos    | Manual o automático (sync o ALTER) | Se crea el campo real en la tabla              |

---

## 🎯 EJEMPLO REAL: Agregar el campo `telefonoEmergencia` al módulo `usuario`

### 1️⃣ Paso 1: Modificar el MODELO Sequelize

📄 `src/database/models/usuario.model.ts`

Buscá los campos del modelo y agregá:
```ts
@Column({ allowNull: true })
telefonoEmergencia?: string;
```

📌 Esto crea una propiedad en el modelo y la mapea con la base de datos.

✅ Si no tenés `@Column` importado, agregalo:
```ts
import { Column } from 'sequelize-typescript';
```

---

### 2️⃣ Paso 2: Modificar los DTOs (Create y Update)

#### 📄 Crear DTO: `usuario.dto.ts`

```ts
@ApiProperty({ example: '123456789', description: 'Teléfono de emergencia del usuario' })
@IsString({ message: 'Debe ser un texto' })
@IsOptional()
telefonoEmergencia?: string;
```

#### 📄 Actualizar DTO: `actualizar-usuario.dto.ts`

Repetí exactamente lo mismo 👆 (los DTOs de update siempre tienen los mismos campos pero opcionales).

✅ ¿Por qué usar `@IsOptional()`? Porque si no lo mandás en la petición, no da error.

---

### 3️⃣ Paso 3: Verificar el CONTROLLER

📄 `usuario.controller.ts`

No tenés que hacer nada si usás los DTOs correctamente en los métodos POST y PATCH:
```ts
@Post()
crear(@Body() dto: CreateUsuarioDto) { ... }

@Patch(':id')
actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarUsuarioDto) { ... }
```

✅ El DTO ya incluye el nuevo campo.

---

### 4️⃣ Paso 4: Verificar el SERVICIO (Service)

📄 `usuario.service.ts`

Si hacés algo como esto:
```ts
const usuario = await this.usuarioModel.create({ ...dto });
```
No tenés que hacer nada más ✅

Pero si estás creando los campos uno por uno:
```ts
usuario.telefonoEmergencia = dto.telefonoEmergencia;
```
📌 Asegurate de agregar la línea para el nuevo campo.

---

### 5️⃣ Paso 5: Modificar la BASE DE DATOS

✅ Si estás en desarrollo y usás Sequelize con sincronización automática (`sync: true`), el campo se crea al reiniciar el proyecto.

⚠️ Pero si estás en producción:
Tenés que modificar la tabla manualmente (con migración o alter):

```sql
ALTER TABLE usuarios ADD COLUMN telefonoEmergencia VARCHAR(255);
```

✅ Recomendado usar migraciones para mantener historial (si usás `sequelize-cli` o `umzug`).

---

### 6️⃣ Paso 6: Verificar que el campo aparece en Swagger

Abrí el navegador y entrá en:
```
http://localhost:4000/api
```

Buscá los endpoints POST y PATCH del módulo `usuario`. 
✅ Deberías ver `telefonoEmergencia` como un campo nuevo.

---

### 7️⃣ Paso 7: Probar con Postman o cliente externo

Probá hacer una petición `POST /usuario` con este body:
```json
{
  "nombreUsuario": "Laura",
  "email": "laura@mail.com",
  "telefonoEmergencia": "1133445566"
}
```
✅ Si no da error y se guarda, ¡listo!

---

## 🎯 Checklist para agregar un campo correctamente

- [x] Modelo actualizado con `@Column`
- [x] DTOs actualizados con validaciones y `@ApiProperty`
- [x] Servicio preparado para recibirlo (si es manual)
- [x] Base de datos modificada (sync o alter)
- [x] Swagger lo muestra
- [x] Probado con Postman

---

Con esta guía podés modificar cualquier entidad sin romper nada.

¿Querés agregar una relación (belongsTo, hasMany, etc.)? Hay otra guía para eso 😉

