/**
 * The combos payload `demo.lab` actually returns — captured, not written.
 *
 * Read on 2026-08-24 from `get_combos(pos_profile="Demo POS")` as
 * `cajero@demo.muelle.mx`, the exact register and cashier the silent-strip
 * report names. It is pasted verbatim (rates, priorities, `targets`,
 * `actual_qty`, `is_stock_item`) because the report's question — "the offers
 * loaded and the strip drew nothing, so which link in the chain is wrong?" —
 * cannot be answered against invented rows. A hand-written fixture would agree
 * with whatever the matcher happens to do.
 *
 * Two facts in here decide that question and are easy to miss by eye:
 *
 *   1. `COMBO-CARGA` targets thirteen items and NONE of them is
 *      «Cargador 20W USB-C». That code is one of its two COMPONENTS.
 *   2. `POSCombo.validate_targets_not_components` throws if you try to make a
 *      component a target, so no seeder can put it there either.
 *
 * Kept in `tests/fixtures/` rather than inline so the attribute-targeting
 * specs measure themselves against the same rows.
 */

import type { ComboOffer } from "../../src/posapp/composables/pos/combos/comboCatalog";

/** Item codes on this demo site ARE the item names, for the celulares catalogue. */
export const DEMO_CHARGER = "Cargador 20W USB-C";
export const DEMO_HANDSET = "iPhone 13 128GB seminuevo";
export const DEMO_CASE = "Funda transparente reforzada";
export const DEMO_CABLE_TARGET = "Cable Lightning 1m";

export const DEMO_COMBOS: ComboOffer[] = [
	{
		item_code: "CAFE-COMBO-DESAYUNO",
		item_name: "Combo Desayuno",
		rate: 129,
		image: "/files/demo-bb7fe810a7a6d275.png",
		priority: 10,
		targets: [
			"CAFE-CAPUCHINO-CH",
			"CAFE-CAPUCHINO-MD",
			"CAFE-CAPUCHINO-GR",
			"CAFE-LATTE-CH",
			"CAFE-LATTE-MD",
			"CAFE-LATTE-GR",
			"CAFE-ESPRESSO",
			"CAFE-AMERICANO-MD",
			"CAFE-AMERICANO-GR",
			"CAFE-CHILAQUILES",
			"CAFE-SANDWICH",
		],
		components: [
			{
				item_code: "CAFE-AMERICANO-CH",
				item_name: "Café Americano Chico",
				qty: 1,
				rate: 32,
				uom: "Nos",
				actual_qty: 0,
				is_stock_item: 0,
			},
			{
				item_code: "CAFE-JUGO-CH",
				item_name: "Jugo de Naranja Chico",
				qty: 1,
				rate: 45,
				uom: "Nos",
				actual_qty: 0,
				is_stock_item: 0,
			},
			{
				item_code: "CAFE-MOLLETES",
				item_name: "Molletes",
				qty: 1,
				rate: 72,
				uom: "Nos",
				actual_qty: 0,
				is_stock_item: 0,
			},
		],
	},
	{
		item_code: "COMBO-PROTECCION",
		item_name: "Combo Protección",
		rate: 299,
		image: "/files/demo-d65caea793428fd1.png",
		priority: 10,
		targets: [
			"iPhone 11 64GB seminuevo",
			"iPhone 13 128GB seminuevo",
			"iPhone SE 2020 seminuevo",
			"Samsung Galaxy A15",
			"Samsung Galaxy A05s",
			"Motorola Moto G24",
			"Xiaomi Redmi 13C",
			"Nokia G20",
			"Funda transparente reforzada",
			"Funda o protector",
			"Mica cerámica 9D",
			"Mica de cristal templado",
		],
		components: [
			{
				item_code: "Funda de silicón con logo",
				item_name: "Funda de silicón con logo",
				qty: 1,
				rate: 160,
				uom: "Unidad",
				actual_qty: 120,
				is_stock_item: 1,
			},
			{
				item_code: "Mica de privacidad",
				item_name: "Mica de privacidad",
				qty: 1,
				rate: 130,
				uom: "Unidad",
				actual_qty: 120,
				is_stock_item: 1,
			},
			{
				item_code: "Instalación de mica",
				item_name: "Instalación de mica",
				qty: 1,
				rate: 50,
				uom: "Servicio",
				actual_qty: 0,
				is_stock_item: 0,
			},
		],
	},
	{
		item_code: "CAFE-COMBO-CONCHA",
		item_name: "Combo Café + Concha",
		rate: 54,
		image: "/files/demo-fa980600f2cce0c3.png",
		priority: 20,
		targets: [
			"CAFE-CAPUCHINO-CH",
			"CAFE-CAPUCHINO-MD",
			"CAFE-CAPUCHINO-GR",
			"CAFE-LATTE-CH",
			"CAFE-LATTE-MD",
			"CAFE-LATTE-GR",
			"CAFE-ESPRESSO",
			"CAFE-AMERICANO-MD",
			"CAFE-AMERICANO-GR",
			"CAFE-CROISSANT",
			"CAFE-CHILAQUILES",
		],
		components: [
			{
				item_code: "CAFE-AMERICANO-CH",
				item_name: "Café Americano Chico",
				qty: 1,
				rate: 32,
				uom: "Nos",
				actual_qty: 0,
				is_stock_item: 0,
			},
			{
				item_code: "CAFE-CONCHA",
				item_name: "Concha",
				qty: 1,
				rate: 34,
				uom: "Nos",
				actual_qty: 0,
				is_stock_item: 0,
			},
		],
	},
	{
		item_code: "COMBO-CARGA",
		item_name: "Combo Carga Rápida",
		rate: 329,
		image: "/files/demo-f7cc8c4e31fc02be.png",
		priority: 20,
		targets: [
			"iPhone 11 64GB seminuevo",
			"iPhone 13 128GB seminuevo",
			"iPhone SE 2020 seminuevo",
			"Samsung Galaxy A15",
			"Samsung Galaxy A05s",
			"Motorola Moto G24",
			"Xiaomi Redmi 13C",
			"Nokia G20",
			"Power bank 10000 mAh",
			"Cargador de coche doble",
			"Cargador de pared",
			"Cable Lightning 1m",
			"Cable USB-C o Lightning",
		],
		components: [
			{
				item_code: "Cargador 20W USB-C",
				item_name: "Cargador 20W USB-C",
				qty: 1,
				rate: 250,
				uom: "Unidad",
				actual_qty: 161,
				is_stock_item: 1,
			},
			{
				item_code: "Cable USB-C 1m",
				item_name: "Cable USB-C 1m",
				qty: 1,
				rate: 110,
				uom: "Unidad",
				actual_qty: 120,
				is_stock_item: 1,
			},
		],
	},
];
