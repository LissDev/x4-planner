# X4 Planner

[Русская инструкция](README.ru.md)

A local station and ship planner using data from X4: Foundations 9.0 and its official expansions. Plan production chains, estimate station costs and income, equip ships, and compare builds. The interface supports English and Russian; English is selected on first use.

## Start on Windows with Docker Desktop

You do not need Node.js, Python, or an X4 installation to run the included planner.

1. Install [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/) and follow its installer instructions. Restart Windows if requested.
2. Start Docker Desktop and wait until its engine is running. Use Linux containers (the default); switch to Linux containers from the Docker tray menu if necessary.
3. On [this repository](https://github.com/LissDev/x4-planner), choose **Code → Download ZIP**. Extract the ZIP, open the extracted folder containing `Dockerfile`, and choose **Open in Terminal** from the folder's context menu. The commands below work in PowerShell.
4. Build the image. The first build downloads dependencies and needs internet access:

   ```powershell
   docker build -t x4-planner .
   ```

5. Start the planner:

   ```powershell
   docker run --rm --name x4-planner -p 127.0.0.1:8765:80 x4-planner
   ```

6. Keep that terminal open and visit [http://127.0.0.1:8765/](http://127.0.0.1:8765/) in your browser. The address is accessible only from your computer. Once built, the planner works without internet access.

To stop it, press **Ctrl+C** in that terminal, or run `docker stop x4-planner` in another terminal. The container is removed automatically. To start again, repeat step 5. If Docker reports a missing engine or connection error, start Docker Desktop and wait for its engine before retrying. If port 8765 is occupied, use `127.0.0.1:8766:80` and open port 8766 instead.

To update, export your saved projects/builds first, download and extract the latest ZIP, stop the container, and repeat steps 4–6 from the new folder. Refresh the browser page. Use the same browser and address to retain access to browser saves.

## First station or ship

- **Stations:** create a project, select final products and target module counts, then choose **Build chain** to preview a production chain with minimum construction cost. **Apply** changes the draft; **Cancel** leaves it unchanged. **Use reserve** adds final modules using existing intermediate production and allowed external supplies. Save with **Save project**.
- Add modules manually, select alternative recipes and races, edit prices and sunlight (100 means 100%), and choose purchased resources or free owned external supplies. Automatic workforce support can add housing, food and medicine; automatic storage covers hourly cargo flows. Construction cost, hourly flows and income update with the draft.
- **Ships:** create a named build, choose a ship and compatible equipment, then select **Save build**. Use **Compare builds** to compare two saved builds against the same target size. Weapon figures are approximate; read the assumptions and partial/unknown labels next to them.

## Saves and backups

Projects and ship builds are stored in your browser's `localStorage`, not in Docker or on a server. Changes are persisted only with **Save project** or **Save build**. Export each saved item as JSON from its list to back it up, and use **Import JSON** in the matching station or ship section to restore it. Import validates the file and asks before replacing an existing item with the same ID.

Keep backups outside this source folder. Clearing browser data, using a private window or another browser/profile, or changing the address can make saves unavailable. `localhost` and `127.0.0.1`, different ports, and opening `index.html` directly use different browser storage contexts. To move between them, export from the old address and import at the new one. Rebuilding/removing a Docker container does not itself delete browser saves. There is no cloud sync or connection to X4 save games.

## Scope and limitations

- Station planning estimates production, workforce supply, construction materials and financial flows. It does not simulate module geometry, blueprint access, ship logistics, stock movements or construction order. Profit assumes the modeled inputs and sales can be achieved.
- The catalog includes 18 official S/M, L and XL ship fabrication/maintenance bays. Their construction materials count toward station cost; ship construction, repairs, yard income and operating workforce/supplies are not simulated.
- Damage is an application estimate, not X4's native combat formula. The out-of-sector estimate uses target-size assumptions. The separate in-sector continuous-fire estimate handles supported reload, magazine and heat profiles, but does not establish exact game behavior. Missing data remains unknown or partial; missiles/ammunition are reported separately. Range, hit geometry and all native combat interactions are not simulated.
- Data reflects the extracted game version and official expansions, not installed mods or later game updates. See [station data sources](DATA-SOURCES.md) and [ship data sources](SHIP-DATA-SOURCES.md) for provenance and regeneration instructions.

## Run directly or develop

For a direct offline run, open `index.html` in a modern browser. Keep `styles.css`, `station-v2.css`, `bundle.js`, `data.js` and `ship-data.js` alongside it. If local-file restrictions interfere, use Docker above.

For source changes, install a current Node.js version supporting `node --test --test-isolation=none` (the Docker build uses Node 22), then run from this folder:

```powershell
npm ci
npm test
npm run build
```

Edit `src/`, then rebuild `bundle.js`. `npm run host-check` optionally checks the browser UI using an installed Edge browser; set `X4_BROWSER` to another supported browser executable if needed. Browser checks write local artifacts to `qa/`.

The bundled [jsLPSolver 1.0.3](https://github.com/JWally/jsLPSolver) uses the Unlicense; its license text is in [vendor/SOLVER-LICENSE.txt](vendor/SOLVER-LICENSE.txt). The repository has no project-wide license. Generated game catalogs retain their game-derived provenance; the solver's license does not license those catalogs.
