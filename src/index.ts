import generateIsolines from "./isolines";
import { DemSource } from "./dem-source";
import { decodeParsedImage } from "./decode-image";
import { LocalDemManager } from "./local-dem-manager";
import CONFIG from "./config";
import { HeightTile } from "./height-tile";
import { SlopeAngleTile } from "./slope-angle-tile";
import { SlopeAngleSource } from "./slope-angle-source";

const exported = {
  generateIsolines,
  DemSource,
  HeightTile,
  SlopeAngleTile,
  SlopeAngleSource,
  LocalDemManager,
  decodeParsedImage,
  set workerUrl(url: string) {
    CONFIG.workerUrl = url;
  },
  get workerUrl() {
    return CONFIG.workerUrl;
  },
};
export default exported;
