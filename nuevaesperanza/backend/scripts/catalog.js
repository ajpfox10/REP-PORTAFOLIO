'use strict';

const { slugify } = require('../src/lib/slug');

// Catálogo de ejemplo. Marcas ficticias; precios en pesos argentinos.

const categories = [
  { slug: 'frutas-y-verduras', name: 'Frutas y verduras', icon: 'apple', color: '#16A34A' },
  { slug: 'almacen', name: 'Almacén', icon: 'wheat', color: '#B45309' },
  { slug: 'lacteos', name: 'Lácteos', icon: 'milk', color: '#2563EB' },
  { slug: 'carnes', name: 'Carnes', icon: 'beef', color: '#DC2626' },
  { slug: 'panaderia', name: 'Panadería', icon: 'croissant', color: '#D97706' },
  { slug: 'bebidas', name: 'Bebidas', icon: 'cup-soda', color: '#0891B2' },
  { slug: 'limpieza', name: 'Limpieza', icon: 'spray-can', color: '#7C3AED' },
  { slug: 'perfumeria', name: 'Perfumería', icon: 'sparkles', color: '#DB2777' },
];

// [categoría, nombre, marca, unidad, precio, precio promo | null, stock, descripción]
const products = [
  ['frutas-y-verduras', 'Manzana roja', 'Valle Verde', '1 kg', 2890, 2390, 120, 'Manzanas rojas del Alto Valle, crocantes y dulces.'],
  ['frutas-y-verduras', 'Banana', 'Valle Verde', '1 kg', 2490, null, 150, 'Bananas maduras, ideales para licuados y postres.'],
  ['frutas-y-verduras', 'Tomate perita', 'Huerta Sur', '1 kg', 2190, 1790, 90, 'Tomate perita para salsas y ensaladas.'],
  ['frutas-y-verduras', 'Papa negra', 'Huerta Sur', '2 kg', 2990, null, 200, 'Papa negra lavada, rinde para hervir, freír u hornear.'],
  ['frutas-y-verduras', 'Lechuga criolla', 'Huerta Sur', '1 unidad', 1290, null, 60, 'Lechuga fresca de quinta.'],
  ['frutas-y-verduras', 'Naranja de jugo', 'Valle Verde', '2 kg', 3190, 2590, 80, 'Naranjas jugosas para exprimir.'],

  ['almacen', 'Arroz largo fino', 'Campo Sur', '1 kg', 1890, null, 140, 'Arroz largo fino 00000, grano suelto.'],
  ['almacen', 'Fideos tirabuzón', 'La Molienda', '500 g', 1290, 990, 160, 'Pasta seca de sémola de trigo candeal.'],
  ['almacen', 'Aceite de girasol', 'Campo Sur', '1,5 L', 3990, 3490, 70, 'Aceite de girasol refinado.'],
  ['almacen', 'Yerba mate suave', 'Tierra Colorada', '1 kg', 5690, null, 110, 'Yerba mate con palo, sabor suave y estacionamiento natural.'],
  ['almacen', 'Azúcar común', 'Campo Sur', '1 kg', 1490, null, 130, 'Azúcar común tipo A.'],
  ['almacen', 'Harina 0000', 'La Molienda', '1 kg', 1190, null, 125, 'Harina de trigo 0000 para repostería.'],
  ['almacen', 'Tomate triturado', 'Huerta Sur', '520 g', 1390, 1090, 95, 'Tomate triturado listo para salsas.'],
  ['almacen', 'Café molido', 'Altura', '250 g', 6290, null, 45, 'Café tostado y molido, tueste medio.'],

  ['lacteos', 'Leche entera', 'La Granja', '1 L', 1690, null, 180, 'Leche entera pasteurizada en sachet.'],
  ['lacteos', 'Yogur bebible de frutilla', 'La Granja', '1 L', 2390, 1890, 75, 'Yogur bebible endulzado sabor frutilla.'],
  ['lacteos', 'Queso cremoso', 'Tambo Real', '1 kg', 9890, 8490, 40, 'Queso cremoso ideal para pizzas y sándwiches.'],
  ['lacteos', 'Manteca', 'Tambo Real', '200 g', 2990, null, 65, 'Manteca de primera calidad.'],
  ['lacteos', 'Dulce de leche clásico', 'La Granja', '400 g', 3290, null, 85, 'Dulce de leche tradicional, cremoso.'],
  ['lacteos', 'Huevos blancos', 'La Granja', '12 unidades', 3890, 3290, 70, 'Huevos frescos de granja, maple de 12.'],

  ['carnes', 'Asado de novillo', 'Estancia Norte', '1 kg', 11990, null, 35, 'Tira de asado de novillo, corte parrillero.'],
  ['carnes', 'Carne picada especial', 'Estancia Norte', '1 kg', 8990, 7690, 50, 'Picada especial con bajo contenido graso.'],
  ['carnes', 'Pechuga de pollo', 'Campo Avícola', '1 kg', 6990, null, 45, 'Pechuga de pollo sin hueso.'],
  ['carnes', 'Milanesas de nalga', 'Estancia Norte', '1 kg', 12490, 10990, 30, 'Milanesas de nalga listas para empanar.'],
  ['carnes', 'Chorizo parrillero', 'Estancia Norte', '1 kg', 7490, null, 40, 'Chorizo puro cerdo para la parrilla.'],

  ['panaderia', 'Pan francés', 'Horno Nuestro', '1 kg', 2590, null, 60, 'Pan francés del día, horneado en el local.'],
  ['panaderia', 'Medialunas de manteca', 'Horno Nuestro', '6 unidades', 3290, 2790, 40, 'Medialunas de manteca recién horneadas.'],
  ['panaderia', 'Pan lactal blanco', 'Horno Nuestro', '550 g', 2890, null, 55, 'Pan de molde para tostadas y sándwiches.'],
  ['panaderia', 'Prepizzas', 'Horno Nuestro', '2 unidades', 2490, null, 35, 'Bases de pizza listas para hornear.'],
  ['panaderia', 'Budín de limón', 'Horno Nuestro', '300 g', 2690, 2190, 30, 'Budín húmedo con glaseado de limón.'],

  ['bebidas', 'Agua mineral sin gas', 'Sierra Pura', '2 L', 1190, null, 200, 'Agua mineral natural de manantial.'],
  ['bebidas', 'Gaseosa cola', 'Burbuja', '2,25 L', 3290, 2790, 120, 'Gaseosa sabor cola.'],
  ['bebidas', 'Jugo de naranja', 'Valle Verde', '1 L', 2190, null, 70, 'Jugo de naranja exprimido, sin azúcar agregada.'],
  ['bebidas', 'Cerveza rubia', 'Cervecería del Sur', '1 L', 2890, null, 90, 'Cerveza rubia tipo lager.'],
  ['bebidas', 'Vino tinto Malbec', 'Viñas de Cuyo', '750 ml', 5990, 4990, 60, 'Malbec joven de Mendoza.'],
  ['bebidas', 'Agua saborizada pomelo', 'Sierra Pura', '1,5 L', 1690, null, 100, 'Agua saborizada sabor pomelo.'],

  ['limpieza', 'Detergente concentrado', 'Brillo', '750 ml', 2490, 1990, 80, 'Detergente para vajilla, rinde más.'],
  ['limpieza', 'Lavandina', 'Brillo', '2 L', 1590, null, 90, 'Lavandina concentrada para desinfectar.'],
  ['limpieza', 'Jabón líquido para ropa', 'Brillo', '3 L', 8990, 7490, 40, 'Jabón líquido para lavarropas.'],
  ['limpieza', 'Papel higiénico', 'Suave', '4 rollos', 2790, null, 110, 'Papel higiénico doble hoja, 30 m.'],
  ['limpieza', 'Limpiador multiuso', 'Brillo', '900 ml', 1990, null, 65, 'Limpiador para pisos y superficies, aroma lavanda.'],

  ['perfumeria', 'Shampoo nutritivo', 'Natura Viva', '400 ml', 4290, 3490, 55, 'Shampoo para todo tipo de cabello.'],
  ['perfumeria', 'Jabón de tocador', 'Natura Viva', '3 unidades', 1990, null, 90, 'Jabón de tocador con glicerina.'],
  ['perfumeria', 'Pasta dental', 'Sonrisa', '90 g', 1890, null, 100, 'Pasta dental con flúor, protección total.'],
  ['perfumeria', 'Desodorante en aerosol', 'Natura Viva', '150 ml', 2990, 2490, 70, 'Desodorante antitranspirante 48 h.'],
  ['perfumeria', 'Protector solar FPS 50', 'Natura Viva', '200 ml', 12990, null, 25, 'Protector solar resistente al agua.'],
];

module.exports = { categories, products, slugify };
