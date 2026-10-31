// Alias esbuild di pngjs: nel browser l'adapter fornisce già un frame RGBA.
export const PNG = {
  sync: {
    read(frame) {
      if (!frame?.data || !Number.isInteger(frame.width) || !Number.isInteger(frame.height)) {
        throw new Error('Frame RGBA browser non valido.');
      }
      return frame;
    },
  },
};
