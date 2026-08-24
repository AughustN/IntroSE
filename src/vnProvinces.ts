/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The 34 province-level units of Việt Nam, per Nghị quyết 202/2025/QH15 (effective 01/07/2025),
 * listed alphabetically so a select renders in the order people scan.
 *
 * "TP.HCM" is kept as the VALUE for Hồ Chí Minh — venues already stored under that spelling would
 * otherwise stop matching their own city on read. Labels may say the long name; values must not
 * drift from what the database holds.
 */
export const VN_PROVINCES = [
  "An Giang",
  "Bắc Ninh",
  "Cà Mau",
  "Cần Thơ",
  "Cao Bằng",
  "Đà Nẵng",
  "Đắk Lắk",
  "Điện Biên",
  "Đồng Nai",
  "Đồng Tháp",
  "Gia Lai",
  "Hà Nội",
  "Hà Tĩnh",
  "Hải Phòng",
  "Huế",
  "Khánh Hòa",
  "Lâm Đồng",
  "Lạng Sơn",
  "Lào Cai",
  "Lai Châu",
  "Nghệ An",
  "Ninh Bình",
  "Phú Thọ",
  "Quảng Ngãi",
  "Quảng Ninh",
  "Quảng Trị",
  "Sơn La",
  "Tây Ninh",
  "Thái Nguyên",
  "Thanh Hóa",
  "TP.HCM",
  "Tuyên Quang",
  "Vĩnh Long",
] as const;

export type VnProvince = (typeof VN_PROVINCES)[number];
