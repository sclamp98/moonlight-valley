Frames for the female character and the male weapon clips were cut from the character videos:
  female_movement_1.mp4  front walk (1-84), back walk (85-153), side walk (154-240)
  female_movement_2.mp4  eating (1-89), two-handed swing (89-235)
  man_wapons_1.mp4       sword swing (1-50), bow (50-108), crossbow (108-170), pistol (172-210)
Extract with:  ffmpeg -i <video> -vsync 0 v_<name>/f_%03d.png   (24 fps, 1280x720)
Then run build_all.py (needs numpy, scipy, pillow). It writes out2/*.png + meta.json; the numbers in
meta.json are the ax/pad/refH values used by FEMALE_ANIM / MALE_WEAPON_ANIM in game.js.
