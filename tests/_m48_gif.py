from PIL import Image
import os
d = r"D:\竖井\tests\_m48-frames"
fs = [os.path.join(d, f) for f in os.listdir(d) if f.endswith(".png")]
fs.sort()
ims = [Image.open(f).convert("RGB") for f in fs]
ims[0].save(r"D:\竖井\tests\m48-breath-compare.gif", save_all=True, append_images=ims[1:],
              duration=114, loop=0)
print(len(ims), "frames ->", os.path.getsize(r"D:\竖井\tests\m48-breath-compare.gif"), "bytes")