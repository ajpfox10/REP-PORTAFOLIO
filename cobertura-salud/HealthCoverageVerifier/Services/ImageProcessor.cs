using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;

namespace HealthCoverageVerifier.Services;

public class ImageProcessor
{
    public string PreprocessImage(string imagePath)
    {
        try
        {
            string outputPath = Path.Combine(Path.GetTempPath(), $"processed_{Guid.NewGuid()}.png");
            using (var original = new Bitmap(imagePath))
            using (var processed = ProcessBasic(original))
            {
                processed.Save(outputPath, ImageFormat.Png);
            }
            return outputPath;
        }
        catch { return imagePath; }
    }

    public string AdvancedPreprocess(string imagePath)
    {
        try
        {
            string outputPath = Path.Combine(Path.GetTempPath(), $"adv_{Guid.NewGuid()}.png");
            using (var original = new Bitmap(imagePath))
            using (var processed = ProcessAdvanced(original))
            {
                processed.Save(outputPath, ImageFormat.Png);
            }
            return outputPath;
        }
        catch { return imagePath; }
    }

    private Bitmap ProcessBasic(Bitmap original)
    {
        var grayscale = ToGrayscale(original);
        var threshold = ApplyThreshold(grayscale, 180);
        var denoised = RemoveNoise(threshold);
        return denoised;
    }

    private Bitmap ProcessAdvanced(Bitmap original)
    {
        var grayscale = ToGrayscale(original);
        var contrasted = EnhanceContrast(grayscale);
        var threshold = ApplyThreshold(contrasted, 160);
        var cleaned = RemoveNoise(threshold);
        var sharpened = Sharpen(cleaned);
        return sharpened;
    }

    private Bitmap ToGrayscale(Bitmap original)
    {
        var result = new Bitmap(original.Width, original.Height);
        for (int x = 0; x < original.Width; x++)
            for (int y = 0; y < original.Height; y++)
            {
                var p = original.GetPixel(x, y);
                int gray = (int)(p.R * 0.299 + p.G * 0.587 + p.B * 0.114);
                result.SetPixel(x, y, Color.FromArgb(gray, gray, gray));
            }
        return result;
    }

    private Bitmap ApplyThreshold(Bitmap image, int threshold)
    {
        var result = new Bitmap(image.Width, image.Height);
        for (int x = 0; x < image.Width; x++)
            for (int y = 0; y < image.Height; y++)
            {
                var p = image.GetPixel(x, y);
                int v = p.R >= threshold ? 255 : 0;
                result.SetPixel(x, y, Color.FromArgb(v, v, v));
            }
        return result;
    }

    private Bitmap RemoveNoise(Bitmap image)
    {
        var result = (Bitmap)image.Clone();
        for (int x = 1; x < image.Width - 1; x++)
            for (int y = 1; y < image.Height - 1; y++)
            {
                if (image.GetPixel(x, y).R == 0)
                {
                    int black = 0;
                    for (int dx = -1; dx <= 1; dx++)
                        for (int dy = -1; dy <= 1; dy++)
                            if ((dx != 0 || dy != 0) && image.GetPixel(x + dx, y + dy).R == 0)
                                black++;
                    if (black < 3) result.SetPixel(x, y, Color.White);
                }
            }
        return result;
    }

    private Bitmap EnhanceContrast(Bitmap image)
    {
        int min = 255, max = 0;
        for (int x = 0; x < image.Width; x++)
            for (int y = 0; y < image.Height; y++)
            {
                int v = image.GetPixel(x, y).R;
                min = Math.Min(min, v); max = Math.Max(max, v);
            }
        var result = new Bitmap(image.Width, image.Height);
        if (max > min)
            for (int x = 0; x < image.Width; x++)
                for (int y = 0; y < image.Height; y++)
                {
                    int v = (image.GetPixel(x, y).R - min) * 255 / (max - min);
                    result.SetPixel(x, y, Color.FromArgb(v, v, v));
                }
        return result;
    }

    private Bitmap Sharpen(Bitmap image)
    {
        var result = new Bitmap(image.Width, image.Height);
        for (int x = 1; x < image.Width - 1; x++)
            for (int y = 1; y < image.Height - 1; y++)
            {
                int sum = 5 * image.GetPixel(x, y).R
                        - image.GetPixel(x - 1, y).R - image.GetPixel(x + 1, y).R
                        - image.GetPixel(x, y - 1).R - image.GetPixel(x, y + 1).R;
                sum = Math.Max(0, Math.Min(255, sum));
                result.SetPixel(x, y, Color.FromArgb(sum, sum, sum));
            }
        return result;
    }

    public List<string> SegmentCharacters(string imagePath)
    {
        var chars = new List<string>();
        try
        {
            using var image = new Bitmap(imagePath);
            using var processed = ProcessBasic(image);
            var hasBlack = new bool[processed.Width];
            for (int x = 0; x < processed.Width; x++)
                for (int y = 0; y < processed.Height; y++)
                    if (processed.GetPixel(x, y).R < 128) { hasBlack[x] = true; break; }

            int start = -1;
            for (int x = 0; x < processed.Width; x++)
            {
                if (hasBlack[x] && start == -1) start = x;
                else if ((!hasBlack[x] || x == processed.Width - 1) && start != -1)
                {
                    if (x - start >= 3)
                    {
                        var charImg = new Bitmap(x - start, processed.Height);
                        for (int cx = 0; cx < x - start; cx++)
                            for (int cy = 0; cy < processed.Height; cy++)
                                charImg.SetPixel(cx, cy, processed.GetPixel(start + cx, cy));
                        var tmp = Path.Combine(Path.GetTempPath(), $"char_{Guid.NewGuid()}.png");
                        charImg.Save(tmp, ImageFormat.Png);
                        chars.Add(tmp);
                    }
                    start = -1;
                }
            }
        }
        catch { }
        return chars;
    }
}
